import express from 'express';
import { randomBytes } from 'crypto';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { acceptedCircleSize } from '../lib/circles.js';

const router = express.Router();
const MAX_CIRCLE_SIZE = 5;

function generateInviteCode() {
  return randomBytes(6).toString('hex');
}

async function getLinkByInviteCode(code) {
  const snap = await db.collection('copilotLinks').where('inviteCode', '==', code).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getUserName(userId) {
  const doc = await db.collection('users').doc(userId).get();
  return doc.data()?.name;
}

router.post('/invites', requireAuth, async (req, res) => {
  if ((await acceptedCircleSize(req.userId)) >= MAX_CIRCLE_SIZE) {
    return res.status(409).json({ error: 'This wing circle is already full (5 co-pilots max)' });
  }
  const { relationshipLabel, copilotEmail } = req.body;
  const inviteCode = generateInviteCode();
  await db.collection('copilotLinks').add({
    pilotUserId: req.userId,
    copilotUserId: null,
    copilotEmail: copilotEmail || null,
    relationshipLabel: relationshipLabel || null,
    inviteCode,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ inviteCode });
});

// Look up an invite by code (used before accepting, e.g. to show who invited them).
router.get('/invites/:code', requireAuth, async (req, res) => {
  const link = await getLinkByInviteCode(req.params.code);
  if (!link) return res.status(404).json({ error: 'Invite not found' });
  const pilotName = await getUserName(link.pilotUserId);
  res.json({ invite: { id: link.id, status: link.status, relationshipLabel: link.relationshipLabel, pilotName, pilotUserId: link.pilotUserId } });
});

// Accept an invite: the current user becomes a co-pilot for the inviting pilot.
router.post('/invites/:code/accept', requireAuth, async (req, res) => {
  const link = await getLinkByInviteCode(req.params.code);
  if (!link) return res.status(404).json({ error: 'Invite not found' });
  if (link.pilotUserId === req.userId) {
    return res.status(400).json({ error: 'You cannot be your own co-pilot' });
  }
  if (link.status === 'accepted') {
    return res.status(409).json({ error: 'This invite has already been used' });
  }
  if ((await acceptedCircleSize(link.pilotUserId)) >= MAX_CIRCLE_SIZE) {
    return res.status(409).json({ error: 'This wing circle is already full (5 co-pilots max)' });
  }

  await db.collection('copilotLinks').doc(link.id).update({ copilotUserId: req.userId, status: 'accepted' });
  const updated = (await db.collection('copilotLinks').doc(link.id).get()).data();
  res.json({ link: { id: link.id, ...updated } });
});

// Co-pilots vouching for me.
router.get('/mine', requireAuth, async (req, res) => {
  const snap = await db.collection('copilotLinks').where('pilotUserId', '==', req.userId).get();
  const links = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const copilotIds = [...new Set(links.filter((l) => l.copilotUserId).map((l) => l.copilotUserId))];
  const users = await Promise.all(copilotIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(users.map((u) => [u.id, u.data()?.name]));

  const copilots = links.map((l) => ({
    id: l.id,
    status: l.status,
    relationshipLabel: l.relationshipLabel,
    inviteCode: l.inviteCode,
    copilotEmail: l.copilotEmail,
    copilotName: l.copilotUserId ? nameById.get(l.copilotUserId) : null,
    copilotUserId: l.copilotUserId,
  }));

  res.json({ copilots, maxCircleSize: MAX_CIRCLE_SIZE, acceptedCount: await acceptedCircleSize(req.userId) });
});

// Pilots I am co-piloting for.
router.get('/piloting-for', requireAuth, async (req, res) => {
  const snap = await db.collection('copilotLinks').where('copilotUserId', '==', req.userId).get();
  const links = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.status === 'accepted')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pilotIds = [...new Set(links.map((l) => l.pilotUserId))];
  const users = await Promise.all(pilotIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(users.map((u) => [u.id, u.data()?.name]));

  const pilots = links.map((l) => ({ id: l.id, relationshipLabel: l.relationshipLabel, pilotName: nameById.get(l.pilotUserId), pilotUserId: l.pilotUserId }));
  res.json({ pilots });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const ref = db.collection('copilotLinks').doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Not found' });
  if (doc.data().pilotUserId !== req.userId) return res.status(403).json({ error: 'Not your co-pilot link' });
  await ref.delete();
  res.json({ ok: true });
});

export { acceptedCircleSize, MAX_CIRCLE_SIZE };
export default router;
