import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { TERMINAL_STATUSES, isPilotOfMatch, getAccessibleMatchRows } from './matches.js';
import { getAcceptedCopilotPilotIds } from '../lib/circles.js';
import { lastReadAt, unreadCount } from '../lib/chat.js';

const router = express.Router();
const EPOCH = '1970-01-01 00:00:00';

function getNotificationState(userId) {
  const row = db.prepare('SELECT * FROM notification_state WHERE user_id = ?').get(userId);
  if (row) return row;
  return { user_id: userId, matches_seen_at: EPOCH, copilots_seen_at: EPOCH };
}

// Every interest whose wing chat I can read: my own outgoing interests, and
// any interest belonging to a pilot I'm an accepted co-pilot for.
function getRelevantInterests(userId, pilotIds) {
  const placeholders = pilotIds.length ? pilotIds.map(() => '?').join(',') : null;
  const clause = placeholders ? `from_user_id = ? OR from_user_id IN (${placeholders})` : 'from_user_id = ?';
  return db.prepare(`SELECT id FROM interests WHERE ${clause}`).all(userId, ...pilotIds);
}

router.get('/summary', requireAuth, (req, res) => {
  const state = getNotificationState(req.userId);
  const matches = getAccessibleMatchRows(req.userId);
  const pilotIds = [...getAcceptedCopilotPilotIds(req.userId)];

  const newMatches = matches.filter((m) => m.created_at > state.matches_seen_at).length;

  let unreadMessages = 0;
  for (const interest of getRelevantInterests(req.userId, pilotIds)) {
    unreadMessages += unreadCount('copilot', interest.id, req.userId, lastReadAt(req.userId, 'copilot', interest.id));
  }
  for (const match of matches) {
    if (isPilotOfMatch(req.userId, match) && !TERMINAL_STATUSES.includes(match.status)) {
      unreadMessages += unreadCount('pilot', match.id, req.userId, lastReadAt(req.userId, 'pilot', match.id));
    }
  }

  const { count: newCopilotAcceptances } = db
    .prepare(
      `SELECT COUNT(*) as count FROM copilot_links WHERE pilot_user_id = ? AND status = 'accepted' AND created_at > ?`
    )
    .get(req.userId, state.copilots_seen_at);

  let pendingVotes = 0;
  if (pilotIds.length > 0) {
    const placeholders = pilotIds.map(() => '?').join(',');
    const votedSubquery = `id NOT IN (SELECT interest_id FROM interest_votes WHERE copilot_user_id = ?)`;
    const { count } = db
      .prepare(`SELECT COUNT(*) as count FROM interests WHERE status = 'pending_wings' AND from_user_id IN (${placeholders}) AND ${votedSubquery}`)
      .get(...pilotIds, req.userId);
    pendingVotes = count;
  }

  res.json({ newMatches, unreadMessages, newCopilotAcceptances, pendingVotes });
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
