import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, name);

  const user = { id: result.lastInsertRowid, email: email.toLowerCase(), name };
  const token = signToken(user);
  res.status(201).json({ token, user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const profile = db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(req.userId);
  res.json({ user, hasProfile: !!profile });
});

export default router;
