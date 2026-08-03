import db from '../db.js';

// All pilots a user currently co-pilots for, fetched once per request to avoid
// re-querying copilot_links per row when checking many interests/matches at once.
export function getAcceptedCopilotPilotIds(copilotUserId) {
  const rows = db
    .prepare(`SELECT pilot_user_id FROM copilot_links WHERE copilot_user_id = ? AND status = 'accepted'`)
    .all(copilotUserId);
  return new Set(rows.map((r) => r.pilot_user_id));
}

export function isAcceptedCopilotFor(copilotUserId, pilotUserId) {
  const row = db
    .prepare(`SELECT 1 FROM copilot_links WHERE copilot_user_id = ? AND pilot_user_id = ? AND status = 'accepted'`)
    .get(copilotUserId, pilotUserId);
  return !!row;
}

export function acceptedCircleSize(pilotUserId) {
  const { count } = db
    .prepare(`SELECT COUNT(*) as count FROM copilot_links WHERE pilot_user_id = ? AND status = 'accepted'`)
    .get(pilotUserId);
  return count;
}

// Pure lookup against an already-fetched pilot-id set — no DB access.
export function copilotSideForPilotIds(pilotIds, match) {
  if (pilotIds.has(match.pilot_a_id)) return 'a';
  if (pilotIds.has(match.pilot_b_id)) return 'b';
  return null;
}
