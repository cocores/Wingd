import db from '../firestore.js';

const MESSAGE_COLLECTIONS = { copilot: 'copilotMessages', pilot: 'pilotMessages' };
const ROOM_ID_FIELDS = { copilot: 'interestId', pilot: 'matchId' };
const EPOCH = '1970-01-01T00:00:00.000Z';

async function withSenderNames(docs) {
  const senderIds = [...new Set(docs.map((d) => d.senderUserId))];
  const senders = await Promise.all(senderIds.map((id) => db.collection('users').doc(id).get()));
  const nameById = new Map(senders.map((s) => [s.id, s.data()?.name]));
  return docs.map((d) => ({ ...d, senderName: nameById.get(d.senderUserId) }));
}

// A thread's messages are naturally small, so this fetches by the one
// equality filter (avoiding a where+orderBy composite index) and sorts in
// memory instead.
export async function getMessages(room, roomId) {
  const snap = await db.collection(MESSAGE_COLLECTIONS[room]).where(ROOM_ID_FIELDS[room], '==', roomId).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return withSenderNames(docs);
}

export async function insertMessage(room, roomId, senderUserId, body) {
  const ref = db.collection(MESSAGE_COLLECTIONS[room]).doc();
  const doc = { [ROOM_ID_FIELDS[room]]: roomId, senderUserId, body, createdAt: new Date().toISOString() };
  await ref.set(doc);
  const [withName] = await withSenderNames([{ id: ref.id, ...doc }]);
  return withName;
}

function chatReadId(userId, room, roomId) {
  return `${userId}__${room}__${roomId}`;
}

export async function markChatRead(userId, room, roomId) {
  await db.collection('chatReads').doc(chatReadId(userId, room, roomId)).set({ userId, room, roomId, lastReadAt: new Date().toISOString() });
}

export async function lastReadAt(userId, room, roomId) {
  const doc = await db.collection('chatReads').doc(chatReadId(userId, room, roomId)).get();
  return doc.exists ? doc.data().lastReadAt : EPOCH;
}

export async function unreadCount(room, roomId, excludeUserId, since) {
  const snap = await db.collection(MESSAGE_COLLECTIONS[room]).where(ROOM_ID_FIELDS[room], '==', roomId).get();
  return snap.docs.filter((d) => {
    const m = d.data();
    return m.senderUserId !== excludeUserId && m.createdAt > since;
  }).length;
}
