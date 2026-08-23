import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { acceptedCircleSize, getAcceptedCopilotPilotIds, isAcceptedCopilotFor } from '../lib/circles.js';
import { getMessages, markChatRead } from '../lib/chat.js';

const router = express.Router();

function getInterestById(id) {
  return db.prepare('SELECT * FROM interests WHERE id = ?').get(id);
}

function computeTally(interestId) {
  const votes = db
    .prepare(
      `SELECT iv.copilot_user_id as copilotUserId, iv.vote, iv.note, iv.created_at as createdAt, u.name as copilotName
       FROM interest_votes iv JOIN users u ON u.id = iv.copilot_user_id
       WHERE iv.interest_id = ? ORDER BY iv.created_at ASC`
    )
    .all(interestId);
  const approveCount = votes.filter((v) => v.vote === 'approve').length;
  const rejectCount = votes.filter((v) => v.vote === 'reject').length;
  return { votes, approveCount, rejectCount };
}

// Attempts to create the mutual match once `interest` (from A to B) has just
// reached 'sent'. Only fires if B's interest in A has also independently
// reached 'sent' — each side's wing review is entirely their own circle's call.
function tryCreateMutualMatch(interest) {
  const reverse = db
    .prepare(`SELECT * FROM interests WHERE from_user_id = ? AND to_user_id = ? AND status = 'sent'`)
    .get(interest.to_user_id, interest.from_user_id);
  if (!reverse) return null;

  const pilotAId = Math.min(interest.from_user_id, interest.to_user_id);
  const pilotBId = Math.max(interest.from_user_id, interest.to_user_id);
  const aInterest = pilotAId === interest.from_user_id ? interest : reverse;
  const bInterest = pilotAId === interest.from_user_id ? reverse : interest;

  db.prepare(
    `INSERT INTO matches (pilot_a_id, pilot_b_id, a_interest_id, b_interest_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(pilot_a_id, pilot_b_id) DO NOTHING`
  ).run(pilotAId, pilotBId, aInterest.id, bInterest.id);
  return db.prepare('SELECT * FROM matches WHERE pilot_a_id = ? AND pilot_b_id = ?').get(pilotAId, pilotBId);
}

function transitionInterest(interestId, status) {
  const updated = db.prepare(`UPDATE interests SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`).get(status, interestId);
  if (status === 'sent') tryCreateMutualMatch(updated);
  return updated;
}

// Re-checks whether a still-pending interest's wing circle has reached a
// majority (sent), reached a majority-can-never-be-reached state once everyone's
// voted (declined), or has no circle at all (auto-sent — nobody to review it).
function resolveInterestStatus(interest) {
  if (interest.status !== 'pending_wings') return interest;

  const circleSize = acceptedCircleSize(interest.from_user_id);
  if (circleSize === 0) return transitionInterest(interest.id, 'sent');

  const { votes, approveCount } = computeTally(interest.id);
  if (approveCount * 2 > circleSize) return transitionInterest(interest.id, 'sent');
  if (votes.length >= circleSize) return transitionInterest(interest.id, 'declined_by_wings');
  return interest;
}

function createOrGetInterest(fromUserId, toUserId) {
  db.prepare(`INSERT INTO interests (from_user_id, to_user_id) VALUES (?, ?) ON CONFLICT(from_user_id, to_user_id) DO NOTHING`).run(
    fromUserId,
    toUserId
  );
  const interest = db.prepare('SELECT * FROM interests WHERE from_user_id = ? AND to_user_id = ?').get(fromUserId, toUserId);
  return resolveInterestStatus(interest);
}

function serializeInterest(interest, viewerUserId) {
  const fromUser = db.prepare('SELECT id, name FROM users WHERE id = ?').get(interest.from_user_id);
  const toUser = db
    .prepare(
      `SELECT u.id, u.name, p.age, p.photo_url as photoUrl, p.bio
       FROM users u LEFT JOIN pilot_profiles p ON p.user_id = u.id WHERE u.id = ?`
    )
    .get(interest.to_user_id);
  const circleSize = acceptedCircleSize(interest.from_user_id);
  const { votes, approveCount, rejectCount } = computeTally(interest.id);
  const myVoteRow = votes.find((v) => v.copilotUserId === viewerUserId);
  const isWing = isAcceptedCopilotFor(viewerUserId, interest.from_user_id);

  return {
    id: interest.id,
    status: interest.status,
    fromUser,
    toUser,
    isMine: viewerUserId === interest.from_user_id,
    isWing,
    circleSize,
    approveCount,
    rejectCount,
    neededForMajority: Math.floor(circleSize / 2) + 1,
    votes: votes.map((v) => ({ copilotUserId: v.copilotUserId, copilotName: v.copilotName, vote: v.vote, note: v.note, createdAt: v.createdAt })),
    myVote: myVoteRow ? myVoteRow.vote : null,
    myNote: myVoteRow ? myVoteRow.note : null,
    canVote: isWing && interest.status === 'pending_wings',
    createdAt: interest.created_at,
  };
}

function hasInterestAccess(userId, interest) {
  return userId === interest.from_user_id || isAcceptedCopilotFor(userId, interest.from_user_id);
}

function assertInterestAccess(req, res, interest) {
  if (!hasInterestAccess(req.userId, interest)) {
    res.status(403).json({ error: 'Not authorized for this interest' });
    return false;
  }
  return true;
}

// Record a swipe. A 'like' queues an interest for the swiper's wing circle
// instead of matching instantly; a 'pass' just keeps them out of the deck.
router.post('/swipes', requireAuth, (req, res) => {
  const { targetUserId, direction } = req.body;
  if (!targetUserId || !['like', 'pass'].includes(direction)) {
    return res.status(400).json({ error: 'targetUserId and a valid direction are required' });
  }
  if (targetUserId === req.userId) {
    return res.status(400).json({ error: 'You cannot swipe on yourself' });
  }

  db.prepare(
    `INSERT INTO swipes (swiper_user_id, target_user_id, direction) VALUES (?, ?, ?)
     ON CONFLICT(swiper_user_id, target_user_id) DO UPDATE SET direction = excluded.direction`
  ).run(req.userId, targetUserId, direction);

  let interest = null;
  if (direction === 'like') {
    interest = serializeInterest(createOrGetInterest(req.userId, targetUserId), req.userId);
  }

  res.json({ ok: true, interest });
});

// Interests I've sent, awaiting my wings, sent onward, or declined.
router.get('/interests/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM interests WHERE from_user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ interests: rows.map((r) => serializeInterest(r, req.userId)) });
});

// Interests awaiting a vote from me, as a wing for one or more pilots.
router.get('/interests/queue', requireAuth, (req, res) => {
  const pilotIds = [...getAcceptedCopilotPilotIds(req.userId)];
  if (pilotIds.length === 0) return res.json({ interests: [] });
  const placeholders = pilotIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM interests WHERE status = 'pending_wings' AND from_user_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...pilotIds);
  res.json({ interests: rows.map((r) => serializeInterest(r, req.userId)) });
});

router.get('/interests/:id', requireAuth, (req, res) => {
  const interest = getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!assertInterestAccess(req, res, interest)) return;
  res.json({ interest: serializeInterest(interest, req.userId) });
});

router.post('/interests/:id/vote', requireAuth, (req, res) => {
  const interest = getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!isAcceptedCopilotFor(req.userId, interest.from_user_id)) {
    return res.status(403).json({ error: 'Only accepted wing circle members can vote on this' });
  }
  if (interest.status !== 'pending_wings') {
    return res.status(400).json({ error: 'This interest has already been decided' });
  }
  const { vote, note } = req.body;
  if (!['approve', 'reject'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "approve" or "reject"' });
  }

  db.prepare(
    `INSERT INTO interest_votes (interest_id, copilot_user_id, vote, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(interest_id, copilot_user_id) DO UPDATE SET vote = excluded.vote, note = excluded.note`
  ).run(interest.id, req.userId, vote, note?.trim() || null);

  const updated = resolveInterestStatus(getInterestById(interest.id));
  res.json({ interest: serializeInterest(updated, req.userId) });
});

router.get('/interests/:id/messages', requireAuth, (req, res) => {
  const interest = getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!assertInterestAccess(req, res, interest)) return;
  const messages = getMessages('copilot', interest.id);
  markChatRead(req.userId, 'copilot', interest.id);
  res.json({ messages });
});

router.post('/interests/:id/mark-read', requireAuth, (req, res) => {
  const interest = getInterestById(req.params.id);
  if (!interest) return res.status(404).json({ error: 'Not found' });
  if (!assertInterestAccess(req, res, interest)) return;
  markChatRead(req.userId, 'copilot', interest.id);
  res.json({ ok: true });
});

export { getInterestById, serializeInterest, assertInterestAccess, hasInterestAccess };
export default router;
