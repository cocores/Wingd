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

router.get('/me', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile: profile || null });
});

router.put('/me', requireAuth, (req, res) => {
  const { age, gender, interestedIn, bio, location, photoUrl } = req.body;
  const existing = db.prepare('SELECT id FROM pilot_profiles WHERE user_id = ?').get(req.userId);

  if (existing) {
    db.prepare(
      `UPDATE pilot_profiles
       SET age = ?, gender = ?, interested_in = ?, bio = ?, location = ?, photo_url = ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(age ?? null, gender ?? null, interestedIn ?? null, bio ?? null, location ?? null, photoUrl ?? null, req.userId);
  } else {
    db.prepare(
      `INSERT INTO pilot_profiles (user_id, age, gender, interested_in, bio, location, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(req.userId, age ?? null, gender ?? null, interestedIn ?? null, bio ?? null, location ?? null, photoUrl ?? null);
  }

  const profile = db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile });
});

router.post('/me/photo', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const photoUrl = `/uploads/${req.file.filename}`;
    const existing = db.prepare('SELECT id FROM pilot_profiles WHERE user_id = ?').get(req.userId);
    if (existing) {
      db.prepare(`UPDATE pilot_profiles SET photo_url = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
        photoUrl,
        req.userId
      );
    } else {
      db.prepare('INSERT INTO pilot_profiles (user_id, photo_url) VALUES (?, ?)').run(req.userId, photoUrl);
    }
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
