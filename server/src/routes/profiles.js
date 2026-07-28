import express from 'express';
import multer from 'multer';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import db from '../db.js';
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

const PROFILE_COLUMNS = {
  age: 'age',
  gender: 'gender',
  interestedIn: 'interested_in',
  bio: 'bio',
  location: 'location',
  photoUrl: 'photo_url',
};

// Partial upsert: only the keys present in `fields` are written, so a photo
// upload can update just photo_url without touching the rest of the profile.
function upsertProfile(userId, fields) {
  const keys = Object.keys(fields);
  const values = keys.map((k) => fields[k] ?? null);
  const existing = db.prepare('SELECT id FROM pilot_profiles WHERE user_id = ?').get(userId);

  if (existing) {
    const setClause = keys.map((k) => `${PROFILE_COLUMNS[k]} = ?`).join(', ');
    db.prepare(`UPDATE pilot_profiles SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`).run(...values, userId);
  } else {
    const columns = ['user_id', ...keys.map((k) => PROFILE_COLUMNS[k])];
    db.prepare(
      `INSERT INTO pilot_profiles (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).run(userId, ...values);
  }

  return db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(userId);
}

router.get('/me', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile: profile || null });
});

router.put('/me', requireAuth, (req, res) => {
  const { age, gender, interestedIn, bio, location, photoUrl } = req.body;
  const profile = upsertProfile(req.userId, { age, gender, interestedIn, bio, location, photoUrl });
  res.json({ profile });
});

router.post('/me/photo', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const photoUrl = `/uploads/${req.file.filename}`;
    upsertProfile(req.userId, { photoUrl });
    res.json({ photoUrl });
  });
});

// Discover feed: other pilots with a complete profile, not yet swiped by the current user.
// Optional query filters: minAge, maxAge, gender (exact match, case-insensitive).
router.get('/discover', requireAuth, (req, res) => {
  const { minAge, maxAge, gender } = req.query;
  const clauses = [
    'u.id != ?',
    'u.id NOT IN (SELECT target_user_id FROM swipes WHERE swiper_user_id = ?)',
  ];
  const params = [req.userId, req.userId];

  if (minAge) {
    clauses.push('p.age IS NOT NULL AND p.age >= ?');
    params.push(Number(minAge));
  }
  if (maxAge) {
    clauses.push('p.age IS NOT NULL AND p.age <= ?');
    params.push(Number(maxAge));
  }
  if (gender) {
    clauses.push('LOWER(p.gender) = LOWER(?)');
    params.push(gender);
  }

  const rows = db
    .prepare(
      `SELECT u.id as userId, u.name, p.age, p.gender, p.interested_in as interestedIn, p.bio, p.location, p.photo_url as photoUrl
       FROM pilot_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY p.created_at DESC`
    )
    .all(...params);
  res.json({ profiles: rows });
});

export default router;
