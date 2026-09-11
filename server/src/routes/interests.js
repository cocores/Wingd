import express from 'express';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { acceptedCircleSize, getAcceptedCopilotPilotIds, getAcceptedWingIds, isAcceptedCopilotFor } from '../lib/circles.js';
import { getMessages, markChatRead } from '../lib/chat.js';
import { isPremium, getDailyLikeCap, getTodayLikeCount, tryConsumeDailyLike } from '../lib/premium.js';
import { sendPushToUser, sendPushToUsers } from '../lib/push.js';

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

  const [aUserDoc, bUserDoc] = await Promise.all([db.collection('users').doc(pilotAId).get(), db.collection('users').doc(pilotBId).get()]);
  const url = `/matches/${docId}/pilot-chat`;
  await Promise.all([
    sendPushToUser(pilotAId, { title: 'You matched! 🛩️', body: `You and ${bUserDoc.data()?.name} matched — say hello!`, url }),
    sendPushToUser(pilotBId, { title: 'You matched! 🛩️', body: `You and ${aUserDoc.data()?.name} matched — say hello!`, url }),
  ]);
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
    const wingIds = await getAcceptedWingIds(fromUserId);
    const status = wingIds.length === 0 ? 'sent' : 'pending_wings';
    await ref.set({ fromUserId, toUserId, status, createdAt: now, updatedAt: now });
    if (status === 'sent') {
      await tryCreateMutualMatch({ id, fromUserId, toUserId });
    } else {
      const fromUserDoc = await db.collection('users').doc(fromUserId).get();
      await sendPushToUsers(wingIds, {
        title: 'Your wing queue has a new one 🗳️',
        body: `${fromUserDoc.data()?.name} wants your vote on someone they're interested in.`,
        url: '/wing-queue',
      });
    }
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

  // Only a brand-new like against this target consumes the daily cap —
  // re-liking someone you're already interested in is a no-op below anyway.
  if (direction === 'like') {
    const alreadyInterested = (await db.collection('interests').doc(interestDocId(req.userId, targetUserId)).get()).exists;
    if (!alreadyInterested && !(await tryConsumeDailyLike(req.userId))) {
      return res.status(429).json({ error: "You've hit today's like limit. Upgrade to premium for unlimited likes." });
    }
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

// Undo the most recent swipe (premium only), as long as a 'like' hasn't
// progressed past waiting on the sender's own wings.
router.post('/swipes/undo', requireAuth, async (req, res) => {
  if (!(await isPremium(req.userId))) {
    return res.status(402).json({ error: 'Upgrade to premium to undo a swipe' });
  }

  const snap = await db.collection('swipes').where('swiperUserId', '==', req.userId).get();
  const swipes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = swipes[0];
  if (!last) return res.status(400).json({ error: 'No swipes to undo' });

  if (last.direction === 'like') {
    const interestRef = db.collection('interests').doc(interestDocId(req.userId, last.targetUserId));
    const interestDoc = await interestRef.get();
    if (interestDoc.exists) {
      if (interestDoc.data().status !== 'pending_wings') {
        return res.status(400).json({ error: 'This interest has already moved on and can\'t be undone' });
      }
      const votesSnap = await db.collection('interestVotes').where('interestId', '==', interestRef.id).get();
      if (!votesSnap.empty) {
        return res.status(400).json({ error: 'Your wings have already started voting on this — can\'t undo' });
      }
      await interestRef.delete();
    }
  }

  await db.collection('swipes').doc(last.id).delete();
  res.json({ ok: true, undone: { targetUserId: last.targetUserId, direction: last.direction } });
});

router.get('/interests/like-status', requireAuth, async (req, res) => {
  const [cap, used, premium] = await Promise.all([getDailyLikeCap(req.userId), getTodayLikeCount(req.userId), isPremium(req.userId)]);
  res.json({ dailyCap: cap === Infinity ? null : cap, usedToday: used, isPremium: premium });
});

// Incoming interests that have already cleared the sender's wings — a
// premium-only look at who's interested before browsing back yourself.
// Excludes anyone already matched (that belongs on the Matches page).
router.get('/interests/admirers', requireAuth, async (req, res) => {
  if (!(await isPremium(req.userId))) {
    return res.status(402).json({ error: 'Upgrade to premium to see who liked you first' });
  }

  const snap = await db.collection('interests').where('toUserId', '==', req.userId).get();
  const sent = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status === 'sent');

  const unmatched = [];
  for (const interest of sent) {
    const { docId } = canonicalMatch(interest.fromUserId, interest.toUserId);
    const matchDoc = await db.collection('matches').doc(docId).get();
    if (!matchDoc.exists) unmatched.push(interest);
  }
  unmatched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const admirers = await Promise.all(
    unmatched.map(async (i) => {
      const [userDoc, profileDoc] = await Promise.all([
        db.collection('users').doc(i.fromUserId).get(),
        db.collection('pilotProfiles').doc(i.fromUserId).get(),
      ]);
      const profile = profileDoc.data() || {};
      return {
        interestId: i.id,
        userId: i.fromUserId,
        name: userDoc.data()?.name,
        age: profile.age ?? null,
        photoUrl: profile.photoUrl ?? null,
        bio: profile.bio ?? null,
        sentAt: i.createdAt,
      };
    })
  );

  res.json({ admirers });
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
