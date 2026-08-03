import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getAcceptedCopilotPilotIds, copilotSideForPilotIds } from '../lib/circles.js';
import { getMessages, insertMessage, markChatRead } from '../lib/chat.js';

const router = express.Router();

const TERMINAL_STATUSES = ['unmatched'];

function getMatchById(id) {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
}

function getMatchOr404(req, res) {
  const match = getMatchById(req.params.id);
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return match;
}

function isPilotOfMatch(userId, match) {
  return userId === match.pilot_a_id || userId === match.pilot_b_id;
}

// Single-match convenience wrapper (one query) for route handlers that only ever
// need the answer for one match, e.g. socket handlers and single-match routes.
function getCopilotSide(copilotUserId, match) {
  const rows = db
    .prepare(
      `SELECT pilot_user_id FROM copilot_links WHERE copilot_user_id = ? AND pilot_user_id IN (?, ?) AND status = 'accepted'`
    )
    .all(copilotUserId, match.pilot_a_id, match.pilot_b_id);
  return copilotSideForPilotIds(new Set(rows.map((r) => r.pilot_user_id)), match);
}

function getUsersByIds(ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).all(...ids);
  return new Map(rows.map((u) => [u.id, u]));
}

// The vouch context for one side of a match: how many wings approved and any
// notes they left, read from the interest that led to this match.
function vouchContext(interestId) {
  if (!interestId) return { circleSize: 0, approveCount: 0, notes: [] };
  const votes = db
    .prepare(
      `SELECT iv.vote, iv.note, u.name as copilotName
       FROM interest_votes iv JOIN users u ON u.id = iv.copilot_user_id
       WHERE iv.interest_id = ? ORDER BY iv.created_at ASC`
    )
    .all(interestId);
  return {
    circleSize: votes.length,
    approveCount: votes.filter((v) => v.vote === 'approve').length,
    notes: votes.filter((v) => v.note).map((v) => ({ copilotName: v.copilotName, note: v.note })),
  };
}

function serializeMatch(match, userId, { mySide, userMap } = {}) {
  const pilotA = userMap ? userMap.get(match.pilot_a_id) : db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_a_id);
  const pilotB = userMap ? userMap.get(match.pilot_b_id) : db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_b_id);
  const resolvedSide = mySide !== undefined ? mySide : getCopilotSide(userId, match);
  const isActive = !TERMINAL_STATUSES.includes(match.status);
  const myInterestId = resolvedSide === 'a' ? match.a_interest_id : resolvedSide === 'b' ? match.b_interest_id : null;

  return {
    id: match.id,
    status: match.status,
    pilotA,
    pilotB,
    aVouch: vouchContext(match.a_interest_id),
    bVouch: vouchContext(match.b_interest_id),
    createdAt: match.created_at,
    isPilot: isPilotOfMatch(userId, match),
    mySide: resolvedSide,
    myInterestId,
    isActive,
    chatUnlocked: isActive,
  };
}

function assertActive(match, res) {
  if (TERMINAL_STATUSES.includes(match.status)) {
    res.status(400).json({ error: 'This match has already ended' });
    return false;
  }
  return true;
}

// Raw match rows where the user is one of the two pilots, or co-pilots for one of them.
function getAccessibleMatchRows(userId) {
  return db
    .prepare(
      `SELECT DISTINCT m.* FROM matches m
       WHERE m.pilot_a_id = ? OR m.pilot_b_id = ?
          OR m.pilot_a_id IN (SELECT pilot_user_id FROM copilot_links WHERE copilot_user_id = ? AND status = 'accepted')
          OR m.pilot_b_id IN (SELECT pilot_user_id FROM copilot_links WHERE copilot_user_id = ? AND status = 'accepted')
       ORDER BY m.created_at DESC`
    )
    .all(userId, userId, userId, userId);
}

router.get('/matches', requireAuth, (req, res) => {
  const rows = getAccessibleMatchRows(req.userId);
  const pilotIds = getAcceptedCopilotPilotIds(req.userId);
  const userMap = getUsersByIds([...new Set(rows.flatMap((m) => [m.pilot_a_id, m.pilot_b_id]))]);

  res.json({
    matches: rows.map((m) => serializeMatch(m, req.userId, { mySide: copilotSideForPilotIds(pilotIds, m), userMap })),
  });
});

router.get('/matches/:id', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  const mySide = getCopilotSide(req.userId, match);
  if (!isPilotOfMatch(req.userId, match) && !mySide) {
    return res.status(403).json({ error: 'You do not have access to this match' });
  }
  res.json({ match: serializeMatch(match, req.userId, { mySide }) });
});

// Either pilot can walk away from a match at any (non-terminal) stage.
router.post('/matches/:id/unmatch', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Only the two pilots can unmatch' });
  }
  if (!assertActive(match, res)) return;

  const updated = db.prepare(`UPDATE matches SET status = 'unmatched' WHERE id = ? RETURNING *`).get(match.id);
  res.json({ match: serializeMatch(updated, req.userId) });
});

router.post('/matches/:id/mark-read', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Not authorized for this room' });
  }
  markChatRead(req.userId, 'pilot', match.id);
  res.json({ ok: true });
});

router.get('/matches/:id/pilot-messages', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Only the two pilots can view this chat' });
  }
  const messages = getMessages('pilot', match.id);
  markChatRead(req.userId, 'pilot', match.id);
  res.json({ messages });
});

export { TERMINAL_STATUSES, getMatchById, isPilotOfMatch, getCopilotSide, getAccessibleMatchRows, markChatRead, getMessages, insertMessage };
export default router;
