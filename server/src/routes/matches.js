import express from 'express';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { getAcceptedCopilotPilotIds, copilotSideForPilotIds } from '../lib/circles.js';
import { getMessages, insertMessage, markChatRead } from '../lib/chat.js';

const router = express.Router();

const TERMINAL_STATUSES = ['unmatched'];

async function getMatchById(id) {
  const doc = await db.collection('matches').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

function isPilotOfMatch(userId, match) {
  return userId === match.pilotAId || userId === match.pilotBId;
}

async function getCopilotSide(copilotUserId, match) {
  const pilotIds = await getAcceptedCopilotPilotIds(copilotUserId);
  return copilotSideForPilotIds(pilotIds, match);
}

async function getUserMap(ids) {
  const uniqueIds = [...new Set(ids)];
  const [userDocs, profileDocs] = await Promise.all([
    Promise.all(uniqueIds.map((id) => db.collection('users').doc(id).get())),
    Promise.all(uniqueIds.map((id) => db.collection('pilotProfiles').doc(id).get())),
  ]);
  const verifiedById = new Map(profileDocs.map((d) => [d.id, !!d.data()?.verified]));
  return new Map(userDocs.map((d) => [d.id, { id: d.id, name: d.data()?.name, verified: verifiedById.get(d.id) || false }]));
}

// The vouch context for one side of a match: how many wings approved and any
// notes they left, read from the interest that led to this match.
async function vouchContext(interestId) {
  if (!interestId) return { circleSize: 0, approveCount: 0, notes: [] };
  const snap = await db.collection('interestVotes').where('interestId', '==', interestId).get();
  const votes = snap.docs.map((d) => d.data());
  const copilotIds = [...new Set(votes.map((v) => v.copilotUserId))];
  const users = await Promise.all(copilotIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(users.map((u) => [u.id, u.data()?.name]));
  return {
    circleSize: votes.length,
    approveCount: votes.filter((v) => v.vote === 'approve').length,
    notes: votes.filter((v) => v.note).map((v) => ({ copilotName: nameById.get(v.copilotUserId), note: v.note })),
  };
}

async function serializeMatch(match, userId, { mySide, userMap } = {}) {
  const map = userMap || (await getUserMap([match.pilotAId, match.pilotBId]));
  const resolvedSide = mySide !== undefined ? mySide : await getCopilotSide(userId, match);
  const isActive = !TERMINAL_STATUSES.includes(match.status);
  const myInterestId = resolvedSide === 'a' ? match.aInterestId : resolvedSide === 'b' ? match.bInterestId : null;
  const [aVouch, bVouch] = await Promise.all([vouchContext(match.aInterestId), vouchContext(match.bInterestId)]);

  return {
    id: match.id,
    status: match.status,
    pilotA: map.get(match.pilotAId),
    pilotB: map.get(match.pilotBId),
    aVouch,
    bVouch,
    createdAt: match.createdAt,
    isPilot: isPilotOfMatch(userId, match),
    mySide: resolvedSide,
    myInterestId,
    isActive,
    chatUnlocked: isActive,
  };
}

// Matches where the user is one of the two pilots, or an accepted co-pilot
// for one of them. Firestore's 'in' operator (max 30 values) lets this run
// as two queries instead of scanning every match.
async function getAccessibleMatchRows(userId) {
  const pilotIds = [...(await getAcceptedCopilotPilotIds(userId))];
  const allIds = [...new Set([userId, ...pilotIds])];
  const [asA, asB] = await Promise.all([
    db.collection('matches').where('pilotAId', 'in', allIds).get(),
    db.collection('matches').where('pilotBId', 'in', allIds).get(),
  ]);
  const byId = new Map();
  for (const d of [...asA.docs, ...asB.docs]) byId.set(d.id, { id: d.id, ...d.data() });
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

router.get('/matches', requireAuth, async (req, res) => {
  const rows = await getAccessibleMatchRows(req.userId);
  const pilotIds = await getAcceptedCopilotPilotIds(req.userId);
  const userMap = await getUserMap(rows.flatMap((m) => [m.pilotAId, m.pilotBId]));

  res.json({
    matches: await Promise.all(rows.map((m) => serializeMatch(m, req.userId, { mySide: copilotSideForPilotIds(pilotIds, m), userMap }))),
  });
});

router.get('/matches/:id', requireAuth, async (req, res) => {
  const match = await getMatchById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const mySide = await getCopilotSide(req.userId, match);
  if (!isPilotOfMatch(req.userId, match) && !mySide) {
    return res.status(403).json({ error: 'You do not have access to this match' });
  }
  res.json({ match: await serializeMatch(match, req.userId, { mySide }) });
});

// Either pilot can walk away from a match at any (non-terminal) stage.
router.post('/matches/:id/unmatch', requireAuth, async (req, res) => {
  const match = await getMatchById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Only the two pilots can unmatch' });
  }
  if (TERMINAL_STATUSES.includes(match.status)) {
    return res.status(400).json({ error: 'This match has already ended' });
  }

  await db.collection('matches').doc(match.id).update({ status: 'unmatched' });
  const updated = await getMatchById(match.id);
  res.json({ match: await serializeMatch(updated, req.userId) });
});

router.post('/matches/:id/mark-read', requireAuth, async (req, res) => {
  const match = await getMatchById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Not authorized for this room' });
  }
  await markChatRead(req.userId, 'pilot', match.id);
  res.json({ ok: true });
});

router.get('/matches/:id/pilot-messages', requireAuth, async (req, res) => {
  const match = await getMatchById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Only the two pilots can view this chat' });
  }
  const messages = await getMessages('pilot', match.id);
  await markChatRead(req.userId, 'pilot', match.id);
  res.json({ messages });
});

export { TERMINAL_STATUSES, getMatchById, isPilotOfMatch, getCopilotSide, getAccessibleMatchRows, markChatRead, getMessages, insertMessage };
export default router;
