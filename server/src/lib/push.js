import { getMessaging } from 'firebase-admin/messaging';
import db from '../firestore.js';

const DEAD_TOKEN_CODES = new Set(['messaging/invalid-registration-token', 'messaging/registration-token-not-registered']);

// Never throws — a push failure (unconfigured project, a dead token, a
// device offline) must never break the request that triggered it (sending
// a chat message, casting a vote, forming a match).
export async function sendPushToUser(userId, { title, body, url }) {
  try {
    const snap = await db.collection('pushTokens').where('userId', '==', userId).get();
    if (snap.empty) return;
    const tokens = snap.docs.map((d) => d.id);

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: url ? { url } : {},
    });

    await Promise.all(
      response.responses.map((r, i) => {
        if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) {
          return db.collection('pushTokens').doc(tokens[i]).delete();
        }
        return null;
      })
    );
  } catch (err) {
    console.error('Push notification failed:', err.message);
  }
}

export async function sendPushToUsers(userIds, payload) {
  await Promise.all([...new Set(userIds)].map((id) => sendPushToUser(id, payload)));
}
