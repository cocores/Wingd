import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isPilotOfMatch, getAccessibleMatchRows, getAcceptedCopilotPilotIds, copilotSideForPilotIds } from './matches.js';

const router = express.Router();
const EPOCH = '1970-01-01 00:00:00';

function getNotificationState(userId) {
  const row = db.prepare('SELECT * FROM notification_state WHERE user_id = ?').get(userId);
  if (row) return row;
  return { user_id: userId, matches_seen_at: EPOCH, copilots_seen_at: EPOCH };
}

function lastReadAt(userId, matchId, room) {
  const row = db
    .prepare('SELECT last_read_at FROM chat_reads WHERE user_id = ? AND match_id = ? AND room = ?')
    .get(userId, matchId, room);
  return row ? row.last_read_at : EPOCH;
}

router.get('/summary', requireAuth, (req, res) => {
  const state = getNotificationState(req.userId);
  const matches = getAccessibleMatchRows(req.userId);
  const pilotIds = getAcceptedCopilotPilotIds(req.userId);

  const newMatches = matches.filter((m) => m.created_at > state.matches_seen_at).length;

  let unreadMessages = 0;
  for (const match of matches) {
    if (copilotSideForPilotIds(pilotIds, match)) {
      const since = lastReadAt(req.userId, match.id, 'copilot');
      const { count } = db
        .prepare(
          'SELECT COUNT(*) as count FROM copilot_messages WHERE match_id = ? AND sender_user_id != ? AND created_at > ?'
        )
        .get(match.id, req.userId, since);
      unreadMessages += count;
    }
    if (isPilotOfMatch(req.userId, match) && match.status === 'approved') {
      const since = lastReadAt(req.userId, match.id, 'pilot');
      const { count } = db
        .prepare(
          'SELECT COUNT(*) as count FROM pilot_messages WHERE match_id = ? AND sender_user_id != ? AND created_at > ?'
        )
        .get(match.id, req.userId, since);
      unreadMessages += count;
    }
  }

  const { count: newCopilotAcceptances } = db
    .prepare(
      `SELECT COUNT(*) as count FROM copilot_links WHERE pilot_user_id = ? AND status = 'accepted' AND created_at > ?`
    )
    .get(req.userId, state.copilots_seen_at);

  res.json({ newMatches, unreadMessages, newCopilotAcceptances });
});

function markSeen(userId, column) {
  db.prepare(
    `INSERT INTO notification_state (user_id, ${column}) VALUES (?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET ${column} = datetime('now')`
  ).run(userId);
}

router.post('/mark-matches-seen', requireAuth, (req, res) => {
  markSeen(req.userId, 'matches_seen_at');
  res.json({ ok: true });
});

router.post('/mark-copilots-seen', requireAuth, (req, res) => {
  markSeen(req.userId, 'copilots_seen_at');
  res.json({ ok: true });
});

export default router;
