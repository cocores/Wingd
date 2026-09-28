import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { detectFace, compareDescriptors, poseMatchesPrompt } from '../lib/faceVerification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
  },
});

// Selfies are compared and discarded, never written to disk — no
// functional reason to keep them, and one less thing to leak.
const selfieUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'));
    cb(null, true);
  },
});

const router = express.Router();

// Partial upsert: only the keys present in `fields` are written, so a photo
// upload can update just photoUrl without touching the rest of the profile.
// Changing the photo invalidates any existing verification — "verified"
// claims the *current* photo is really them, so it can't survive swapping
// in a different, unverified one.
async function upsertProfile(userId, fields) {
  const ref = db.collection('pilotProfiles').doc(userId);
  const existing = await ref.get();
  const now = new Date().toISOString();
  const photoChanged = 'photoUrl' in fields && existing.exists && fields.photoUrl !== existing.data().photoUrl;
  await ref.set(
    { ...fields, updatedAt: now, ...(existing.exists ? {} : { createdAt: now }), ...(photoChanged ? { verified: false, verifiedAt: null } : {}) },
    { merge: true }
  );
  return (await ref.get()).data();
}

router.get('/me', requireAuth, async (req, res) => {
  const doc = await db.collection('pilotProfiles').doc(req.userId).get();
  res.json({ profile: doc.exists ? doc.data() : null });
});

router.put('/me', requireAuth, async (req, res) => {
  const { age, gender, interestedIn, bio, location, photoUrl } = req.body;
  const profile = await upsertProfile(req.userId, {
    age: age ?? null,
    gender: gender ?? null,
    interestedIn: interestedIn ?? null,
    bio: bio ?? null,
    location: location ?? null,
    photoUrl: photoUrl ?? null,
  });
  res.json({ profile });
});

router.post('/me/photo', requireAuth, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const photoUrl = `/uploads/${req.file.filename}`;
    await upsertProfile(req.userId, { photoUrl });
    res.json({ photoUrl });
  });
});

// Verifies a live selfie is (a) really a face performing the requested
// pose and (b) the same person as the current profile photo. Both checks
// run server-side so a client can't just report success — the pose check
// blocks the naive "upload some other photo" attack, and the face-match
// is what the "verified" badge actually promises.
router.post('/me/verify', requireAuth, (req, res) => {
  selfieUpload.single('selfie')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No selfie captured' });

    const { pose } = req.body;
    if (!['straight', 'left', 'right'].includes(pose)) {
      return res.status(400).json({ error: 'pose must be "straight", "left", or "right"' });
    }

    const profileDoc = await db.collection('pilotProfiles').doc(req.userId).get();
    const photoUrl = profileDoc.data()?.photoUrl;
    if (!photoUrl) {
      return res.status(400).json({ error: 'Add a profile photo first — verification compares your selfie against it' });
    }

    let referenceBuffer;
    try {
      referenceBuffer = await fs.promises.readFile(path.join(uploadsDir, path.basename(photoUrl)));
    } catch {
      return res.status(400).json({ error: 'Could not read your profile photo — try re-uploading it' });
    }

    // multer's callback-style API means a rejection in here becomes an
    // unhandled rejection (crashing the whole process) unless caught — and
    // this is a public upload endpoint, so a corrupt/unsupported image must
    // be a clean 400, never a crash.
    let selfie;
    let reference;
    try {
      [selfie, reference] = await Promise.all([detectFace(req.file.buffer), detectFace(referenceBuffer)]);
    } catch (err) {
      console.error('Face detection failed:', err.message);
      return res.status(400).json({ error: 'Could not process that image — try a different photo' });
    }

    if (selfie.faceCount === 0) return res.status(400).json({ error: 'No face detected — try again with better lighting' });
    if (selfie.faceCount > 1) return res.status(400).json({ error: 'More than one face detected — make sure it\'s just you in frame' });
    if (reference.faceCount !== 1) {
      return res.status(400).json({ error: 'Could not find a clear face in your profile photo — try uploading a different one' });
    }
    if (!poseMatchesPrompt(selfie.yaw, pose)) {
      return res.status(400).json({ error: 'That doesn\'t look like the pose we asked for — try again' });
    }

    const { isMatch } = compareDescriptors(selfie.descriptor, reference.descriptor);
    if (!isMatch) {
      return res.status(400).json({ error: 'That selfie doesn\'t look like a match for your profile photo — try again in good lighting, facing the camera' });
    }

    await upsertProfile(req.userId, { verified: true, verifiedAt: new Date().toISOString() });
    res.json({ ok: true, verified: true });
  });
});

// Discover feed: other pilots with a complete profile, not yet swiped by the
// current user. Optional filters: minAge, maxAge, gender (exact, case-insensitive).
// Profiles are fetched in full and filtered in memory — fine at this scale,
// and it avoids needing composite indexes for the filter combinations below.
router.get('/discover', requireAuth, async (req, res) => {
  const { minAge, maxAge, gender } = req.query;

  const swipedSnap = await db.collection('swipes').where('swiperUserId', '==', req.userId).get();
  const swipedIds = new Set(swipedSnap.docs.map((d) => d.data().targetUserId));

  const profilesSnap = await db.collection('pilotProfiles').get();
  let candidates = profilesSnap.docs
    .map((d) => ({ userId: d.id, ...d.data() }))
    .filter((p) => p.userId !== req.userId && !swipedIds.has(p.userId));

  if (minAge) candidates = candidates.filter((p) => p.age != null && p.age >= Number(minAge));
  if (maxAge) candidates = candidates.filter((p) => p.age != null && p.age <= Number(maxAge));
  if (gender) candidates = candidates.filter((p) => (p.gender || '').toLowerCase() === gender.toLowerCase());

  candidates.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const userIds = candidates.map((p) => p.userId);
  const users = await Promise.all(userIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(users.map((u) => [u.id, u.data()?.name]));

  const profiles = candidates.map((p) => ({
    userId: p.userId,
    name: nameById.get(p.userId),
    age: p.age,
    gender: p.gender,
    interestedIn: p.interestedIn,
    bio: p.bio,
    location: p.location,
    photoUrl: p.photoUrl,
    verified: !!p.verified,
  }));

  res.json({ profiles });
});

export default router;
