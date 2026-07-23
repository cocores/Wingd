import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

// Discover feed: other pilots with a complete profile, not yet swiped by the current user.
router.get('/discover', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id as userId, u.name, p.age, p.gender, p.interested_in as interestedIn, p.bio, p.location, p.photo_url as photoUrl
       FROM pilot_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE u.id != ?
         AND u.id NOT IN (
           SELECT target_user_id FROM swipes WHERE swiper_user_id = ?
         )
       ORDER BY p.created_at DESC`
    )
    .all(req.userId, req.userId);
  res.json({ profiles: rows });
});

export default router;
