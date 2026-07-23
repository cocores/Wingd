import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function getMatchOr404(req, res) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return match;
}

function isCopilotOf(copilotUserId, pilotUserId) {
  const link = db
    .prepare(
      `SELECT id FROM copilot_links WHERE copilot_user_id = ? AND pilot_user_id = ? AND status = 'accepted'`
    )
    .get(copilotUserId, pilotUserId);
  return !!link;
}

// A user can access the co-pilot vetting room for a match if they co-pilot for pilot A or pilot B.
function canAccessCopilotRoom(userId, match) {
  return isCopilotOf(userId, match.pilot_a_id) || isCopilotOf(userId, match.pilot_b_id);
}

function isPilotOfMatch(userId, match) {
  return userId === match.pilot_a_id || userId === match.pilot_b_id;
}

function serializeMatch(match, userId) {
  const pilotA = db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_a_id);
  const pilotB = db.prepare('SELECT id, name FROM users WHERE id = ?').get(match.pilot_b_id);
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
    canAccessCopilotRoom: canAccessCopilotRoom(userId, match),
  };
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

router.get('/matches', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM matches WHERE pilot_a_id = ? OR pilot_b_id = ? ORDER BY created_at DESC')
    .all(req.userId, req.userId);
  res.json({ matches: rows.map((m) => serializeMatch(m, req.userId)) });
});

router.get('/matches/:id', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!isPilotOfMatch(req.userId, match) && !canAccessCopilotRoom(req.userId, match)) {
    return res.status(403).json({ error: 'You do not have access to this match' });
  }
  res.json({ match: serializeMatch(match, req.userId) });
});

// A co-pilot of one of the two pilots approves the match on behalf of their pilot.
router.post('/matches/:id/approve', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;

  const side = isCopilotOf(req.userId, match.pilot_a_id) ? 'a' : isCopilotOf(req.userId, match.pilot_b_id) ? 'b' : null;
  if (!side) return res.status(403).json({ error: 'Only a co-pilot of one of these pilots can vouch on a match' });

  db.prepare(`UPDATE matches SET ${side}_approved = 1, ${side}_rejected = 0 WHERE id = ?`).run(match.id);
  let updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);

  if (updated.a_approved && updated.b_approved && updated.status !== 'approved') {
    db.prepare(`UPDATE matches SET status = 'approved' WHERE id = ?`).run(match.id);
    updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);
  }

  res.json({ match: serializeMatch(updated, req.userId) });
});

router.post('/matches/:id/reject', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;

  const side = isCopilotOf(req.userId, match.pilot_a_id) ? 'a' : isCopilotOf(req.userId, match.pilot_b_id) ? 'b' : null;
  if (!side) return res.status(403).json({ error: 'Only a co-pilot of one of these pilots can vouch on a match' });

  db.prepare(`UPDATE matches SET ${side}_rejected = 1, ${side}_approved = 0, status = 'rejected' WHERE id = ?`).run(match.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id);
  res.json({ match: serializeMatch(updated, req.userId) });
});

router.get('/matches/:id/copilot-messages', requireAuth, (req, res) => {
  const match = getMatchOr404(req, res);
  if (!match) return;
  if (!canAccessCopilotRoom(req.userId, match)) {
    return res.status(403).json({ error: 'Only co-pilots on this match can view this chat' });
  }
  const rows = db
    .prepare(
      `SELECT cm.id, cm.body, cm.created_at as createdAt, cm.sender_user_id as senderUserId, u.name as senderName
       FROM copilot_messages cm JOIN users u ON u.id = cm.sender_user_id
       WHERE cm.match_id = ? ORDER BY cm.created_at ASC`
    )
    .all(match.id);
  res.json({ messages: rows });
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
  const rows = db
    .prepare(
      `SELECT pm.id, pm.body, pm.created_at as createdAt, pm.sender_user_id as senderUserId, u.name as senderName
       FROM pilot_messages pm JOIN users u ON u.id = pm.sender_user_id
       WHERE pm.match_id = ? ORDER BY pm.created_at ASC`
    )
    .all(match.id);
  res.json({ messages: rows });
});

export { isCopilotOf, canAccessCopilotRoom, isPilotOfMatch };
export default router;
