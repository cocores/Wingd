import db from '../firestore.js';

// Reads are filtered to one equality clause server-side and refined in
// memory — wing circles are capped at 5 members, so this never scans more
// than a handful of documents, and it avoids needing composite indexes for
// what would otherwise be two-field equality queries.
async function copilotLinksForPilot(pilotUserId) {
  const snap = await db.collection('copilotLinks').where('pilotUserId', '==', pilotUserId).get();
  return snap.docs.map((d) => d.data());
}

export async function getAcceptedCopilotPilotIds(copilotUserId) {
  const snap = await db.collection('copilotLinks').where('copilotUserId', '==', copilotUserId).get();
  return new Set(snap.docs.map((d) => d.data()).filter((l) => l.status === 'accepted').map((l) => l.pilotUserId));
}

export async function isAcceptedCopilotFor(copilotUserId, pilotUserId) {
  const links = await copilotLinksForPilot(pilotUserId);
  return links.some((l) => l.copilotUserId === copilotUserId && l.status === 'accepted');
}

export async function acceptedCircleSize(pilotUserId) {
  const links = await copilotLinksForPilot(pilotUserId);
  return links.filter((l) => l.status === 'accepted').length;
}

export function copilotSideForPilotIds(pilotIds, match) {
  if (pilotIds.has(match.pilotAId)) return 'a';
  if (pilotIds.has(match.pilotBId)) return 'b';
  return null;
}
