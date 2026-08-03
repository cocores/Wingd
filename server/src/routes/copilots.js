import express from 'express';
import { randomBytes } from 'crypto';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { acceptedCircleSize } from '../lib/circles.js';

const router = express.Router();
const MAX_CIRCLE_SIZE = 5;

function generateInviteCode() {
  return randomBytes(6).toString('hex');
}

// Create an invite link for a friend to become a co-pilot for the current (pilot) user.
router.post('/invites', requireAuth, (req, res) => {
  if (acceptedCircleSize(req.userId) >= MAX_CIRCLE_SIZE) {
    return res.status(409).json({ error: 'This wing circle is already full (5 co-pilots max)' });
  }
  const { relationshipLabel, copilotEmail } = req.body;
  const inviteCode = generateInviteCode();
  db.prepare(
    `INSERT INTO copilot_links (pilot_user_id, copilot_email, relationship_label, invite_code, status)
     VALUES (?, ?, ?, ?, 'pending')`
  ).run(req.userId, copilotEmail || null, relationshipLabel || null, inviteCode);

  res.status(201).json({ inviteCode });
});

// Look up an invite by code (used before accepting, e.g. to show who invited them).
router.get('/invites/:code', requireAuth, (req, res) => {
  const invite = db
    .prepare(
      `SELECT cl.id, cl.status, cl.relationship_label as relationshipLabel, u.name as pilotName, u.id as pilotUserId
       FROM copilot_links cl JOIN users u ON u.id = cl.pilot_user_id
       WHERE cl.invite_code = ?`
    )
    .get(req.params.code);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  res.json({ invite });
});

// Accept an invite: the current user becomes a co-pilot for the inviting pilot.
router.post('/invites/:code/accept', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT * FROM copilot_links WHERE invite_code = ?').get(req.params.code);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.pilot_user_id === req.userId) {
    return res.status(400).json({ error: 'You cannot be your own co-pilot' });
  }
  if (invite.status === 'accepted') {
    return res.status(409).json({ error: 'This invite has already been used' });
  }
  if (acceptedCircleSize(invite.pilot_user_id) >= MAX_CIRCLE_SIZE) {
    return res.status(409).json({ error: 'This wing circle is already full (5 co-pilots max)' });
  }

  db.prepare(`UPDATE copilot_links SET copilot_user_id = ?, status = 'accepted' WHERE id = ?`).run(req.userId, invite.id);
  const updated = db.prepare('SELECT * FROM copilot_links WHERE id = ?').get(invite.id);
  res.json({ link: updated });
});

// Co-pilots vouching for me.
router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT cl.id, cl.status, cl.relationship_label as relationshipLabel, cl.invite_code as inviteCode,
              cl.copilot_email as copilotEmail, u.name as copilotName, u.id as copilotUserId
       FROM copilot_links cl LEFT JOIN users u ON u.id = cl.copilot_user_id
       WHERE cl.pilot_user_id = ? ORDER BY cl.created_at DESC`
    )
    .all(req.userId);
  res.json({ copilots: rows, maxCircleSize: MAX_CIRCLE_SIZE, acceptedCount: acceptedCircleSize(req.userId) });
});

// Pilots I am co-piloting for.
router.get('/piloting-for', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT cl.id, cl.relationship_label as relationshipLabel, u.name as pilotName, u.id as pilotUserId
       FROM copilot_links cl JOIN users u ON u.id = cl.pilot_user_id
       WHERE cl.copilot_user_id = ? AND cl.status = 'accepted' ORDER BY cl.created_at DESC`
    )
    .all(req.userId);
  res.json({ pilots: rows });
});

router.delete('/:id', requireAuth, (req, res) => {
  const link = db.prepare('SELECT * FROM copilot_links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  if (link.pilot_user_id !== req.userId) return res.status(403).json({ error: 'Not your co-pilot link' });
  db.prepare('DELETE FROM copilot_links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export { acceptedCircleSize, MAX_CIRCLE_SIZE };
export default router;
