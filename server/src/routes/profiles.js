import express from 'express';
import multer from 'multer';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';

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

const router = express.Router();

// Partial upsert: only the keys present in `fields` are written, so a photo
// upload can update just photoUrl without touching the rest of the profile.
async function upsertProfile(userId, fields) {
  const ref = db.collection('pilotProfiles').doc(userId);
  const existing = await ref.get();
  const now = new Date().toISOString();
  await ref.set({ ...fields, updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
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
  }));

  res.json({ profiles });
});

export default router;
