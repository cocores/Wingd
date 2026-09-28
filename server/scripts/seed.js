// Seeds a handful of known test accounts for manual QA / demos. Safe to
// re-run: existing seed users are deleted first (including their profile,
// wing links, interests, and matches) and recreated fresh.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import db from '../src/firestore.js';

const PASSWORD = 'password123';

const USERS = [
  { email: 'alice@wingd.test', name: 'Alice Test', profile: { age: 27, gender: 'woman', interestedIn: 'men', bio: 'Pilot seed account with a full wing circle.', location: 'Austin, TX' } },
  { email: 'bob@wingd.test', name: 'Bob Test', profile: { age: 29, gender: 'man', interestedIn: 'women', bio: 'Pilot seed account with no wing circle yet.', location: 'Austin, TX' } },
  { email: 'wing1@wingd.test', name: 'Wing One', profile: null },
  { email: 'wing2@wingd.test', name: 'Wing Two', profile: null },
];

async function deleteExistingUser(email) {
  const indexRef = db.collection('emailIndex').doc(email);
  const indexDoc = await indexRef.get();
  if (!indexDoc.exists) return;
  const userId = indexDoc.data().userId;

  const [asPilot, asCopilot, asFrom, asTo, votesByMe, matchesA, matchesB] = await Promise.all([
    db.collection('copilotLinks').where('pilotUserId', '==', userId).get(),
    db.collection('copilotLinks').where('copilotUserId', '==', userId).get(),
    db.collection('interests').where('fromUserId', '==', userId).get(),
    db.collection('interests').where('toUserId', '==', userId).get(),
    db.collection('interestVotes').where('copilotUserId', '==', userId).get(),
    db.collection('matches').where('pilotAId', '==', userId).get(),
    db.collection('matches').where('pilotBId', '==', userId).get(),
  ]);
  const toDelete = [...asPilot.docs, ...asCopilot.docs, ...asFrom.docs, ...asTo.docs, ...votesByMe.docs, ...matchesA.docs, ...matchesB.docs];
  await Promise.all(toDelete.map((d) => d.ref.delete()));

  await Promise.all([
    db.collection('pilotProfiles').doc(userId).delete(),
    db.collection('users').doc(userId).delete(),
    indexRef.delete(),
  ]);
}

async function createUser({ email, name }) {
  await deleteExistingUser(email);
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const userRef = db.collection('users').doc();
  await db.collection('emailIndex').doc(email).create({ userId: userRef.id });
  await userRef.set({ email, passwordHash, name, createdAt: new Date().toISOString() });
  return userRef.id;
}

async function setProfile(userId, profile) {
  if (!profile) return;
  const now = new Date().toISOString();
  await db.collection('pilotProfiles').doc(userId).set({ ...profile, photoUrl: null, createdAt: now, updatedAt: now });
}

async function acceptedWingLink(pilotUserId, copilotUserId, relationshipLabel) {
  await db.collection('copilotLinks').add({
    pilotUserId,
    copilotUserId,
    copilotEmail: null,
    relationshipLabel,
    inviteCode: randomBytes(6).toString('hex'),
    status: 'accepted',
    createdAt: new Date().toISOString(),
  });
}

const ids = {};
for (const u of USERS) {
  ids[u.email] = await createUser(u);
  await setProfile(ids[u.email], u.profile);
}

await acceptedWingLink(ids['alice@wingd.test'], ids['wing1@wingd.test'], 'Best friend');
await acceptedWingLink(ids['alice@wingd.test'], ids['wing2@wingd.test'], 'College roommate');

const now = new Date().toISOString();
// Alice likes Bob: queued for her wing circle to vote on (canVote demo).
await db.collection('interests').doc(`${ids['alice@wingd.test']}__${ids['bob@wingd.test']}`).set({
  fromUserId: ids['alice@wingd.test'],
  toUserId: ids['bob@wingd.test'],
  status: 'pending_wings',
  createdAt: now,
  updatedAt: now,
});
// Bob likes Alice: Bob has no wings, so this auto-sends (empty-circle demo).
await db.collection('interests').doc(`${ids['bob@wingd.test']}__${ids['alice@wingd.test']}`).set({
  fromUserId: ids['bob@wingd.test'],
  toUserId: ids['alice@wingd.test'],
  status: 'sent',
  createdAt: now,
  updatedAt: now,
});

console.log('Seeded test accounts (all use password: %s):', PASSWORD);
for (const u of USERS) console.log(`  ${u.email}`);
console.log("\nAlice -> Bob interest is queued in Wing One / Wing Two's Wing Queue.");
console.log("Bob -> Alice interest auto-sent (Bob has no wing circle) — log in as Wing One/Two and approve to trigger a match.");
process.exit(0);
