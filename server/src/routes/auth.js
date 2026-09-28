import express from 'express';
import bcrypt from 'bcryptjs';
import db, { GrpcStatus } from '../firestore.js';
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

  const emailKey = email.toLowerCase();
  const userRef = db.collection('users').doc();
  try {
    // The email index doc id is the uniqueness constraint: .create() fails
    // atomically if another signup already claimed this email.
    await db.collection('emailIndex').doc(emailKey).create({ userId: userRef.id });
  } catch (err) {
    if (err.code === GrpcStatus.ALREADY_EXISTS) return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await userRef.set({ email: emailKey, passwordHash, name, createdAt: new Date().toISOString() });

  const user = { id: userRef.id, email: emailKey, name };
  const token = signToken(user);
  res.status(201).json({ token, user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const indexDoc = await db.collection('emailIndex').doc(email.toLowerCase()).get();
  const userDoc = indexDoc.exists ? await db.collection('users').doc(indexDoc.data().userId).get() : null;
  const user = userDoc?.exists ? userDoc.data() : null;

  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken({ id: userDoc.id, email: user.email });
  res.json({ token, user: { id: userDoc.id, email: user.email, name: user.name } });
});

router.post('/google', async (req, res) => {
  if (!googleConfigured()) return res.status(501).json({ error: 'Google sign-in is not configured on this server' });
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential is required' });

  try {
    const { providerId, email, name } = await verifyGoogleCredential(credential);
    const user = await findOrCreateSocialUser({ provider: 'google', providerId, email, name });
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
    const user = await findOrCreateSocialUser({ provider: 'apple', providerId, email, name });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (err.message === 'NO_EMAIL') {
      return res.status(400).json({ error: 'Your Apple account did not share an email address' });
    }
    res.status(401).json({ error: 'Could not verify Apple sign-in' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const userDoc = await db.collection('users').doc(req.userId).get();
  if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
  const { email, name } = userDoc.data();
  const profileDoc = await db.collection('pilotProfiles').doc(req.userId).get();
  res.json({ user: { id: userDoc.id, email, name }, hasProfile: profileDoc.exists });
});

export default router;
