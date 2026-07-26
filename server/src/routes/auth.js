import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import {
  googleConfigured,
  appleConfigured,
  verifyGoogleCredential,
  verifyAppleCredential,
  findOrCreateSocialUser,
} from '../lib/socialAuth.js';

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
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.post('/google', async (req, res) => {
  if (!googleConfigured()) return res.status(501).json({ error: 'Google sign-in is not configured on this server' });
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential is required' });

  try {
    const { providerId, email, name } = await verifyGoogleCredential(credential);
    const user = findOrCreateSocialUser(db, { provider: 'google', providerId, email, name });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (err.message === 'NO_EMAIL') {
      return res.status(400).json({ error: 'Your Google account did not share an email address' });
    }
    res.status(401).json({ error: 'Could not verify Google sign-in' });
  }
});

router.post('/apple', async (req, res) => {
  if (!appleConfigured()) return res.status(501).json({ error: 'Sign in with Apple is not configured on this server' });
  const { idToken, name } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  try {
    const { providerId, email } = await verifyAppleCredential(idToken, name);
    const user = findOrCreateSocialUser(db, { provider: 'apple', providerId, email, name });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (err.message === 'NO_EMAIL') {
      return res.status(400).json({ error: 'Your Apple account did not share an email address' });
    }
    res.status(401).json({ error: 'Could not verify Apple sign-in' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const profile = db.prepare('SELECT * FROM pilot_profiles WHERE user_id = ?').get(req.userId);
  res.json({ user, hasProfile: !!profile });
});

export default router;
