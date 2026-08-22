// Seeds a handful of known test accounts for manual QA / demos. Safe to
// re-run: existing seed users are deleted first (cascades clean up their
// profiles, wing links, interests, and matches) and recreated fresh.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import db from '../src/db.js';

const PASSWORD = 'password123';

const USERS = [
  { email: 'alice@wingd.test', name: 'Alice Test', profile: { age: 27, gender: 'woman', interestedIn: 'men', bio: 'Pilot seed account with a full wing circle.', location: 'Austin, TX' } },
  { email: 'bob@wingd.test', name: 'Bob Test', profile: { age: 29, gender: 'man', interestedIn: 'women', bio: 'Pilot seed account with no wing circle yet.', location: 'Austin, TX' } },
  { email: 'wing1@wingd.test', name: 'Wing One', profile: null },
  { email: 'wing2@wingd.test', name: 'Wing Two', profile: null },
];

function createUser({ email, name }) {
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, passwordHash, name);
  return lastInsertRowid;
}

function setProfile(userId, profile) {
  if (!profile) return;
  db.prepare(
    `INSERT INTO pilot_profiles (user_id, age, gender, interested_in, bio, location) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, profile.age, profile.gender, profile.interestedIn, profile.bio, profile.location);
}

function acceptedWingLink(pilotUserId, copilotUserId, relationshipLabel) {
  db.prepare(
    `INSERT INTO copilot_links (pilot_user_id, copilot_user_id, relationship_label, invite_code, status)
     VALUES (?, ?, ?, ?, 'accepted')`
  ).run(pilotUserId, copilotUserId, relationshipLabel, randomBytes(6).toString('hex'));
}

const ids = {};
for (const u of USERS) {
  ids[u.email] = createUser(u);
  setProfile(ids[u.email], u.profile);
}

acceptedWingLink(ids['alice@wingd.test'], ids['wing1@wingd.test'], 'Best friend');
acceptedWingLink(ids['alice@wingd.test'], ids['wing2@wingd.test'], 'College roommate');

// Alice likes Bob: queued for her wing circle to vote on (canVote demo).
db.prepare(`INSERT INTO interests (from_user_id, to_user_id) VALUES (?, ?)`).run(ids['alice@wingd.test'], ids['bob@wingd.test']);
// Bob likes Alice: Bob has no wings, so this auto-sends (empty-circle demo).
db.prepare(`INSERT INTO interests (from_user_id, to_user_id, status) VALUES (?, ?, 'sent')`).run(ids['bob@wingd.test'], ids['alice@wingd.test']);

console.log('Seeded test accounts (all use password: %s):', PASSWORD);
for (const u of USERS) console.log(`  ${u.email}`);
console.log('\nAlice -> Bob interest is queued in Wing One / Wing Two\'s Wing Queue.');
console.log('Bob -> Alice interest auto-sent (Bob has no wing circle) — log in as Wing One/Two and approve to trigger a match.');
