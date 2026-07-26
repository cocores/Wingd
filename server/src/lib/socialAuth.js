import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

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
export function findOrCreateSocialUser(db, { provider, providerId, email, name }) {
  const column = provider === 'google' ? 'google_id' : 'apple_id';

  let user = db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(providerId);
  if (user) return user;

  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (user) {
      db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(providerId, user.id);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
  }

  if (!email) {
    throw new Error('NO_EMAIL');
  }

  const displayName = name || email.split('@')[0];
  const result = db
    .prepare(`INSERT INTO users (email, name, ${column}) VALUES (?, ?, ?)`)
    .run(email.toLowerCase(), displayName, providerId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}
