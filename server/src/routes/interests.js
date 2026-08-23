import express from 'express';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { acceptedCircleSize, getAcceptedCopilotPilotIds, isAcceptedCopilotFor } from '../lib/circles.js';
import { getMessages, markChatRead } from '../lib/chat.js';

const router = express.Router();

function interestDocId(fromUserId, toUserId) {
  return `${fromUserId}__${toUserId}`;
}

function voteDocId(interestId, copilotUserId) {
  return `${interestId}__${copilotUserId}`;
}

// Firestore doc ids for a match are a canonical (sorted) pair, so either
// direction of a mutual interest resolves to the same match document.
function canonicalMatch(userA, userB) {
  const [pilotAId, pilotBId] = [userA, userB].sort();
  return { pilotAId, pilotBId, docId: `${pilotAId}__${pilotBId}` };
}

async function getInterestById(id) {
  const doc = await db.collection('interests').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function hasInterestAccess(userId, interest) {
  return userId === interest.fromUserId || isAcceptedCopilotFor(userId, interest.fromUserId);
}

async function computeTally(interestId) {
  const snap = await db.collection('interestVotes').where('interestId', '==', interestId).get();
  const raw = snap.docs.map((d) => d.data()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const copilotIds = [...new Set(raw.map((v) => v.copilotUserId))];
  const users = await Promise.all(copilotIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(users.map((u) => [u.id, u.data()?.name]));
  const votes = raw.map((v) => ({ copilotUserId: v.copilotUserId, copilotName: nameById.get(v.copilotUserId), vote: v.vote, note: v.note, createdAt: v.createdAt }));
  return { votes, approveCount: votes.filter((v) => v.vote === 'approve').length, rejectCount: votes.filter((v) => v.vote === 'reject').length };
}

// Attempts to create the mutual match once `interest` (from A to B) has just
// reached 'sent'. Only fires if B's interest in A has also independently
// reached 'sent'. Idempotent (deterministic match doc id, identical content
// regardless of which side's transition triggers it), so no transaction needed.
async function tryCreateMutualMatch(interest) {
  const reverseDoc = await db.collection('interests').doc(interestDocId(interest.toUserId, interest.fromUserId)).get();
  if (!reverseDoc.exists || reverseDoc.data().status !== 'sent') return;
  const reverse = { id: reverseDoc.id, ...reverseDoc.data() };

  const { pilotAId, pilotBId, docId } = canonicalMatch(interest.fromUserId, interest.toUserId);
  const aInterest = pilotAId === interest.fromUserId ? interest : reverse;
  const bInterest = pilotAId === interest.fromUserId ? reverse : interest;

  const matchRef = db.collection('matches').doc(docId);
  if ((await matchRef.get()).exists) return;
  await matchRef.set({
    pilotAId,
    pilotBId,
    aInterestId: aInterest.id,
    bInterestId: bInterest.id,
    status: 'matched',
    createdAt: new Date().toISOString(),
  });
}

// A circle with nobody in it has nothing to review, so the interest sends
// immediately. Otherwise this only auto-sends on an empty circle at creation
// time — once wings exist, transitions happen inside the vote transaction.
async function createOrGetInterest(fromUserId, toUserId) {
  const id = interestDocId(fromUserId, toUserId);
  const ref = db.collection('interests').doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    const now = new Date().toISOString();
    const circleSize = await acceptedCircleSize(fromUserId);
    const status = circleSize === 0 ? 'sent' : 'pending_wings';
    await ref.set({ fromUserId, toUserId, status, createdAt: now, updatedAt: now });
    if (status === 'sent') await tryCreateMutualMatch({ id, fromUserId, toUserId });
  }
  return getInterestById(id);
}

async function serializeInterest(interest, viewerUserId) {
  const [fromUserDoc, toUserDoc, toProfileDoc, circleSize, tally, isWing] = await Promise.all([
    db.collection('users').doc(interest.fromUserId).get(),
    db.collection('users').doc(interest.toUserId).get(),
    db.collection('pilotProfiles').doc(interest.toUserId).get(),
    acceptedCircleSize(interest.fromUserId),
    computeTally(interest.id),
    isAcceptedCopilotFor(viewerUserId, interest.fromUserId),
  ]);
  const { votes, approveCount, rejectCount } = tally;
  const myVoteRow = votes.find((v) => v.copilotUserId === viewerUserId);
  const toProfile = toProfileDoc.data() || {};

  return {
    id: interest.id,
    status: interest.status,
    fromUser: { id: interest.fromUserId, name: fromUserDoc.data()?.name },
    toUser: { id: interest.toUserId, name: toUserDoc.data()?.name, age: toProfile.age ?? null, photoUrl: toProfile.photoUrl ?? null, bio: toProfile.bio ?? null },
    isMine: viewerUserId === interest.fromUserId,
    isWing,
    circleSize,
    approveCount,
    rejectCount,
    neededForMajority: Math.floor(circleSize / 2) + 1,
    votes,
    myVote: myVoteRow ? myVoteRow.vote : null,
    myNote: myVoteRow ? myVoteRow.note : null,
    canVote: isWing && interest.status === 'pending_wings',
    createdAt: interest.createdAt,
  };
}

// Record a swipe. A 'like' queues an interest for the swiper's wing circle
// instead of matching instantly; a 'pass' just keeps them out of the deck.
router.post('/swipes', requireAuth, async (req, res) => {
  const { targetUserId, direction } = req.body;
  if (!targetUserId || !['like', 'pass'].includes(direction)) {
    return res.status(400).json({ error: 'targetUserId and a valid direction are required' });
  }
  if (targetUserId === req.userId) {
    return res.status(400).json({ error: 'You cannot swipe on yourself' });
  }

  await db
    .collection('swipes')
    .doc(`${req.userId}__${targetUserId}`)
    .set({ swiperUserId: req.userId, targetUserId, direction, createdAt: new Date().toISOString() });

  let interest = null;
  if (direction === 'like') {
    interest = await serializeInterest(await createOrGetInterest(req.userId, targetUserId), req.userId);
  }

  res.json({ ok: true, interest });
});

// Interests I've sent, awaiting my wings, sent onward, or declined.
router.get('/interests/mine', requireAuth, async (req, res) => {
  const snap = await db.collection('interests').where('fromUserId', '==', req.userId).get();
  const interests = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ interests: await Promise.all(interests.map((i) => serializeInterest(i, req.userId))) });
});

// Interests awaiting a vote from me, as a wing for one or more pilots. Fans
// out one equality query per pilot instead of a compound where+in, avoiding
// a composite index for (fromUserId, status).
router.get('/interests/queue', requireAuth, async (req, res) => {
  const pilotIds = [...(await getAcceptedCopilotPilotIds(req.userId))];
  if (pilotIds.length === 0) return res.json({ interests: [] });
  const snaps = await Promise.all(pilotIds.map((id) => db.collection('interests').where('fromUserId', '==', id).get()));
  const interests = snaps
    .flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .filter((i) => i.status === 'pending_wings')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ interests: await Promise.all(interests.map((i) => serializeInterest(i, req.userId))) });
});

router.get('/interests/:id', requireAuth, async (req, res) => {
  const interest = await getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!(await hasInterestAccess(req.userId, interest))) return res.status(403).json({ error: 'Not authorized for this interest' });
  res.json({ interest: await serializeInterest(interest, req.userId) });
});

router.post('/interests/:id/vote', requireAuth, async (req, res) => {
  const { vote, note } = req.body;
  if (!['approve', 'reject'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "approve" or "reject"' });
  }

  const interestRef = db.collection('interests').doc(req.params.id);
  const outcome = await db.runTransaction(async (tx) => {
    const interestDoc = await tx.get(interestRef);
    if (!interestDoc.exists) return { httpError: [404, 'Not found'] };
    const interest = { id: interestDoc.id, ...interestDoc.data() };

    const circleSnap = await tx.get(db.collection('copilotLinks').where('pilotUserId', '==', interest.fromUserId));
    const circle = circleSnap.docs.map((d) => d.data()).filter((l) => l.status === 'accepted');
    if (!circle.some((l) => l.copilotUserId === req.userId)) {
      return { httpError: [403, 'Only accepted wing circle members can vote on this'] };
    }
    if (interest.status !== 'pending_wings') {
      return { httpError: [400, 'This interest has already been decided'] };
    }

    const votesSnap = await tx.get(db.collection('interestVotes').where('interestId', '==', interest.id));
    const now = new Date().toISOString();
    const myVote = { interestId: interest.id, copilotUserId: req.userId, vote, note: note?.trim() || null, createdAt: now };
    tx.set(db.collection('interestVotes').doc(voteDocId(interest.id, req.userId)), myVote);

    const otherVotes = votesSnap.docs.map((d) => d.data()).filter((v) => v.copilotUserId !== req.userId);
    const allVotes = [...otherVotes, myVote];
    const approveCount = allVotes.filter((v) => v.vote === 'approve').length;

    let status = interest.status;
    if (approveCount * 2 > circle.length) status = 'sent';
    else if (allVotes.length >= circle.length) status = 'declined_by_wings';

    if (status !== interest.status) tx.update(interestRef, { status, updatedAt: now });

    return { interestId: interest.id, fromUserId: interest.fromUserId, toUserId: interest.toUserId, status };
  });

  if (outcome.httpError) {
    const [statusCode, error] = outcome.httpError;
    return res.status(statusCode).json({ error });
  }

  if (outcome.status === 'sent') {
    await tryCreateMutualMatch({ id: outcome.interestId, fromUserId: outcome.fromUserId, toUserId: outcome.toUserId });
  }

  const updated = await getInterestById(outcome.interestId);
  res.json({ interest: await serializeInterest(updated, req.userId) });
});

router.get('/interests/:id/messages', requireAuth, async (req, res) => {
  const interest = await getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!(await hasInterestAccess(req.userId, interest))) return res.status(403).json({ error: 'Not authorized for this interest' });
  const messages = await getMessages('copilot', interest.id);
  await markChatRead(req.userId, 'copilot', interest.id);
  res.json({ messages });
});

router.post('/interests/:id/mark-read', requireAuth, async (req, res) => {
  const interest = await getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!(await hasInterestAccess(req.userId, interest))) return res.status(403).json({ error: 'Not authorized for this interest' });
  await markChatRead(req.userId, 'copilot', interest.id);
  res.json({ ok: true });
});

export { getInterestById, serializeInterest, hasInterestAccess, voteDocId };
export default router;
