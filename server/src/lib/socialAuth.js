import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import db from '../firestore.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || '';
const APPLE_ISSUER = 'https://appleid.apple.com';

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const appleJwks = jwksClient({ jwksUri: `${APPLE_ISSUER}/auth/keys`, cache: true, cacheMaxAge: 24 * 60 * 60 * 1000 });

export function googleConfigured() {
  return !!GOOGLE_CLIENT_ID;
}

export function appleConfigured() {
  return !!APPLE_CLIENT_ID;
}

// Verifies a Google Identity Services credential (an ID token JWT) and
// returns the profile it vouches for. Throws if the token is invalid,
// expired, or was issued for a different client.
export async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return { providerId: payload.sub, email: payload.email, name: payload.name };
}

function getAppleSigningKey(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// Verifies a "Sign in with Apple" ID token against Apple's published JWKS.
// Apple only includes the user's name in the client-side response on their
// very first authorization (never in the token itself), so callers pass
// whatever name they captured then.
export async function verifyAppleCredential(idToken, fallbackName) {
  const payload = await new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getAppleSigningKey,
      { algorithms: ['RS256'], issuer: APPLE_ISSUER, audience: APPLE_CLIENT_ID },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
  return { providerId: payload.sub, email: payload.email, name: fallbackName || null };
}

// Finds the user a social login belongs to, linking or creating an account
// as needed: match by provider id first, then by email (linking the
// provider id onto that existing account), then create a brand-new user.
export async function findOrCreateSocialUser({ provider, providerId, email, name }) {
  const field = provider === 'google' ? 'googleId' : 'appleId';

  const byProvider = await db.collection('users').where(field, '==', providerId).limit(1).get();
  if (!byProvider.empty) {
    const doc = byProvider.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  if (email) {
    const emailKey = email.toLowerCase();
    const indexDoc = await db.collection('emailIndex').doc(emailKey).get();
    if (indexDoc.exists) {
      const userRef = db.collection('users').doc(indexDoc.data().userId);
      await userRef.update({ [field]: providerId });
      const updated = await userRef.get();
      return { id: updated.id, ...updated.data() };
    }
  }

  if (!email) {
    throw new Error('NO_EMAIL');
  }

  const emailKey = email.toLowerCase();
  const displayName = name || email.split('@')[0];
  const userRef = db.collection('users').doc();
  // Reserves the email atomically the same way signup does — .create() fails
  // if another request already claimed it (e.g. a concurrent social login).
  await db.collection('emailIndex').doc(emailKey).create({ userId: userRef.id });
  const doc = { email: emailKey, name: displayName, [field]: providerId, createdAt: new Date().toISOString() };
  await userRef.set(doc);
  return { id: userRef.id, ...doc };
}
