import express from 'express';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { TERMINAL_STATUSES, isPilotOfMatch, getAccessibleMatchRows } from './matches.js';
import { voteDocId } from './interests.js';
import { getAcceptedCopilotPilotIds } from '../lib/circles.js';
import { lastReadAt, unreadCount } from '../lib/chat.js';

const router = express.Router();
const EPOCH = '1970-01-01T00:00:00.000Z';

async function getNotificationState(userId) {
  const doc = await db.collection('notificationState').doc(userId).get();
  return doc.exists ? doc.data() : { matchesSeenAt: EPOCH, copilotsSeenAt: EPOCH };
}

// Every interest whose wing chat I can read: my own outgoing interests, and
// any interest belonging to a pilot I'm an accepted co-pilot for.
async function getRelevantInterestIds(userId, pilotIds) {
  const ids = [...new Set([userId, ...pilotIds])];
  const snaps = await Promise.all(ids.map((id) => db.collection('interests').where('fromUserId', '==', id).get()));
  return snaps.flatMap((s) => s.docs.map((d) => d.id));
}

router.get('/summary', requireAuth, async (req, res) => {
  const state = await getNotificationState(req.userId);
  const matches = await getAccessibleMatchRows(req.userId);
  const pilotIds = [...(await getAcceptedCopilotPilotIds(req.userId))];

  const newMatches = matches.filter((m) => m.createdAt > state.matchesSeenAt).length;

  let unreadMessages = 0;
  const interestIds = await getRelevantInterestIds(req.userId, pilotIds);
  for (const interestId of interestIds) {
    unreadMessages += await unreadCount('copilot', interestId, req.userId, await lastReadAt(req.userId, 'copilot', interestId));
  }
  for (const match of matches) {
    if (isPilotOfMatch(req.userId, match) && !TERMINAL_STATUSES.includes(match.status)) {
      unreadMessages += await unreadCount('pilot', match.id, req.userId, await lastReadAt(req.userId, 'pilot', match.id));
    }
  }

  const linksSnap = await db.collection('copilotLinks').where('pilotUserId', '==', req.userId).get();
  const newCopilotAcceptances = linksSnap.docs
    .map((d) => d.data())
    .filter((l) => l.status === 'accepted' && l.createdAt > state.copilotsSeenAt).length;

  let pendingVotes = 0;
  if (pilotIds.length > 0) {
    const snaps = await Promise.all(pilotIds.map((id) => db.collection('interests').where('fromUserId', '==', id).get()));
    const pendingIds = snaps
      .flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
      .filter((i) => i.status === 'pending_wings')
      .map((i) => i.id);
    const votedChecks = await Promise.all(pendingIds.map((id) => db.collection('interestVotes').doc(voteDocId(id, req.userId)).get()));
    pendingVotes = votedChecks.filter((d) => !d.exists).length;
  }

  res.json({ newMatches, unreadMessages, newCopilotAcceptances, pendingVotes });
});

async function markSeen(userId, field) {
  await db.collection('notificationState').doc(userId).set({ [field]: new Date().toISOString() }, { merge: true });
}

router.post('/mark-matches-seen', requireAuth, async (req, res) => {
  await markSeen(req.userId, 'matchesSeenAt');
  res.json({ ok: true });
});

router.post('/mark-copilots-seen', requireAuth, async (req, res) => {
  await markSeen(req.userId, 'copilotsSeenAt');
  res.json({ ok: true });
});

// The token is the doc id, so re-registering it (a new login on the same
// device, say) just reassigns ownership instead of creating a duplicate.
router.post('/register-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  await db.collection('pushTokens').doc(token).set({ userId: req.userId, updatedAt: new Date().toISOString() });
  res.json({ ok: true });
});

router.post('/unregister-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  const ref = db.collection('pushTokens').doc(token);
  const doc = await ref.get();
  if (doc.exists && doc.data().userId === req.userId) await ref.delete();
  res.json({ ok: true });
});

export default router;
