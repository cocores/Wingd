import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const TERMINAL_STATUSES = ['rejected', 'unmatched'];
const MESSAGE_TABLES = { copilot: 'copilot_messages', pilot: 'pilot_messages' };

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

// All pilots a user currently co-pilots for, fetched once per request to avoid
// re-querying copilot_links per match when checking many matches at once.
function getAcceptedCopilotPilotIds(copilotUserId) {
  const rows = db
    .prepare(`SELECT pilot_user_id FROM copilot_links WHERE copilot_user_id = ? AND status = 'accepted'`)
    .all(copilotUserId);
  return new Set(rows.map((r) => r.pilot_user_id));
}

// Pure lookup against an already-fetched pilot-id set — no DB access.
function copilotSideForPilotIds(pilotIds, match) {
  if (pilotIds.has(match.pilot_a_id)) return 'a';
  if (pilotIds.has(match.pilot_b_id)) return 'b';
  return null;
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

function canAccessCopilotRoom(userId, match) {
  return !!getCopilotSide(userId, match);
}

function getUsersByIds(ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).all(...ids);
  return new Map(rows.map((u) => [u.id, u]));
}

function serializeMatch(match, userId, { mySide, userMap } = {}) {
  const pilotA = userMap ? userMap.get(match.pilot_a_id) : db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_a_id);
  const pilotB = userMap ? userMap.get(match.pilot_b_id) : db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_b_id);
  const resolvedSide = mySide !== undefined ? mySide : getCopilotSide(userId, match);
  const isActive = !TERMINAL_STATUSES.includes(match.status);
  const myApproved = resolvedSide ? !!match[`${resolvedSide}_approved`] : false;

  return {
    id: match.id,
    status: match.status,
    pilotA,
    pilotB,
    aApproved: !!match.a_approved,
    bApproved: !!match.b_approved,
    aRejected: !!match.a_rejected,
    bRejected: !!match.b_rejected,
    createdAt: match.created_at,
    isPilot: isPilotOfMatch(userId, match),
    canAccessCopilotRoom: !!resolvedSide,
    mySide: resolvedSide,
    myApproved,
    isActive,
    canVouch: !!resolvedSide && isActive && !myApproved,
    canWithdraw: !!resolvedSide && isActive && myApproved,
    chatUnlocked: match.status === 'approved',
  };
}

function assertActive(match, res) {
  if (TERMINAL_STATUSES.includes(match.status)) {
    res.status(400).json({ error: 'This match has already ended' });
    return false;
  }
  return true;
}

function getMessages(room, matchId) {
  const table = MESSAGE_TABLES[room];
  return db
    .prepare(
      `SELECT m.id, m.body, m.created_at as createdAt, m.sender_user_id as senderUserId, u.name as senderName
       FROM ${table} m JOIN users u ON u.id = m.sender_user_id
       WHERE m.match_id = ? ORDER BY m.created_at ASC`
    )
    .all(matchId);
}

function insertMessage(room, matchId, senderUserId, body) {
  const table = MESSAGE_TABLES[room];
  const result = db.prepare(`INSERT INTO ${table} (match_id, sender_user_id, body) VALUES (?, ?, ?)`).run(matchId, senderUserId, body);
  return db
    .prepare(
      `SELECT m.id, m.body, m.created_at as createdAt, m.sender_user_id as senderUserId, u.name as senderName
       FROM ${table} m JOIN users u ON u.id = m.sender_user_id WHERE m.id = ?`
    )
    .get(result.lastInsertRowid);
}

function markChatRead(userId, matchId, room) {
  db.prepare(
    `INSERT INTO chat_reads (user_id, match_id, room, last_read_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, match_id, room) DO UPDATE SET last_read_at = datetime('now')`
  ).run(userId, matchId, room);
}

// Record a swipe. If both users have liked each other, create a match.
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

  let match = null;
  if (direction === 'like') {
    const mutual = db
      .prepare(`SELECT id FROM swipes WHERE swiper_user_id = ? AND target_user_id = ? AND direction = 'like'`)
      .get(targetUserId, req.userId);
    if (mutual) {
      const pilotAId = Math.min(req.userId, targetUserId);
      const pilotBId = Math.max(req.userId, targetUserId);
      db.prepare(
        `INSERT INTO matches (pilot_a_id, pilot_b_id) VALUES (?, ?)
         ON CONFLICT(pilot_a_id, pilot_b_id) DO NOTHING`
      ).run(pilotAId, pilotBId);
      const row = db.prepare('SELECT * FROM matches WHERE pilot_a_id = ? AND pilot_b_id = ?').get(pilotAId, pilotBId);
      match = serializeMatch(row, req.userId);
    }
  }

  res.json({ ok: true, match });
});

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

// A co-pilot of one of the two pilots approves the match on behalf of their pilot.
router.post('/matches/:id/approve', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!assertActive(match, res)) return;

  const side = getCopilotSide(req.userId, match);
  if (!side) return res.status(403).json({ error: 'Only a co-pilot of one of these pilots can vouch on a match' });

  let updated = db.prepare(`UPDATE matches SET ${side}_approved = 1, ${side}_rejected = 0 WHERE id = ? RETURNING *`).get(match.id);

  if (updated.a_approved && updated.b_approved && updated.status !== 'approved') {
    updated = db.prepare(`UPDATE matches SET status = 'approved' WHERE id = ? RETURNING *`).get(match.id);
  }

  res.json({ match: serializeMatch(updated, req.userId, { mySide: side }) });
});

router.post('/matches/:id/reject', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!assertActive(match, res)) return;

  const side = getCopilotSide(req.userId, match);
  if (!side) return res.status(403).json({ error: 'Only a co-pilot of one of these pilots can vouch on a match' });

  const updated = db
    .prepare(`UPDATE matches SET ${side}_rejected = 1, ${side}_approved = 0, status = 'rejected' WHERE id = ? RETURNING *`)
    .get(match.id);
  res.json({ match: serializeMatch(updated, req.userId, { mySide: side }) });
});

// A co-pilot withdraws a previously-given vouch. If the match had already been fully
// approved, this re-locks the pilot chat by dropping the match back to co-pilot review.
router.post('/matches/:id/withdraw', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!assertActive(match, res)) return;

  const side = getCopilotSide(req.userId, match);
  if (!side) return res.status(403).json({ error: 'Only a co-pilot of one of these pilots can vouch on a match' });
  if (!match[`${side}_approved`]) {
    return res.status(400).json({ error: 'You have not vouched for this match yet' });
  }

  const updated = db
    .prepare(
      `UPDATE matches SET ${side}_approved = 0, status = CASE WHEN status = 'approved' THEN 'copilot_review' ELSE status END WHERE id = ? RETURNING *`
    )
    .get(match.id);
  res.json({ match: serializeMatch(updated, req.userId, { mySide: side }) });
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

// Lets an open chat window keep marking itself read as live messages arrive over the socket.
router.post('/matches/:id/mark-read', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  const { room } = req.body;
  if (room === 'copilot' && canAccessCopilotRoom(req.userId, match)) {
    markChatRead(req.userId, match.id, 'copilot');
  } else if (room === 'pilot' && isPilotOfMatch(req.userId, match)) {
    markChatRead(req.userId, match.id, 'pilot');
  } else {
    return res.status(403).json({ error: 'Not authorized for this room' });
  }
  res.json({ ok: true });
});

router.get('/matches/:id/copilot-messages', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!canAccessCopilotRoom(req.userId, match)) {
    return res.status(403).json({ error: 'Only co-pilots on this match can view this chat' });
  }
  const messages = getMessages('copilot', match.id);
  markChatRead(req.userId, match.id, 'copilot');
  res.json({ messages });
});

router.get('/matches/:id/pilot-messages', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!isPilotOfMatch(req.userId, match)) {
    return res.status(403).json({ error: 'Only the two pilots can view this chat' });
  }
  if (match.status !== 'approved') {
    return res.status(403).json({ error: 'This chat unlocks once both sides\' co-pilots approve the match' });
  }
  const messages = getMessages('pilot', match.id);
  markChatRead(req.userId, match.id, 'pilot');
  res.json({ messages });
});

export {
  TERMINAL_STATUSES,
  getMatchById,
  canAccessCopilotRoom,
  isPilotOfMatch,
  getAccessibleMatchRows,
  getAcceptedCopilotPilotIds,
  copilotSideForPilotIds,
  markChatRead,
  getMessages,
  insertMessage,
};
export default router;
