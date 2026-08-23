import db from '../db.js';

const MESSAGE_TABLES = { copilot: 'copilot_messages', pilot: 'pilot_messages' };
const ROOM_ID_COLUMNS = { copilot: 'interest_id', pilot: 'match_id' };
const EPOCH = '1970-01-01 00:00:00';

export function getMessages(room, roomId) {
  const table = MESSAGE_TABLES[room];
  const idColumn = ROOM_ID_COLUMNS[room];
  return db
    .prepare(
      `SELECT m.id, m.body, m.created_at as createdAt, m.sender_user_id as senderUserId, u.name as senderName
       FROM ${table} m JOIN users u ON u.id = m.sender_user_id
       WHERE m.${idColumn} = ? ORDER BY m.created_at ASC`
    )
    .all(roomId);
}

export function insertMessage(room, roomId, senderUserId, body) {
  const table = MESSAGE_TABLES[room];
  const idColumn = ROOM_ID_COLUMNS[room];
  const result = db.prepare(`INSERT INTO ${table} (${idColumn}, sender_user_id, body) VALUES (?, ?, ?)`).run(roomId, senderUserId, body);
  return db
    .prepare(
      `SELECT m.id, m.body, m.created_at as createdAt, m.sender_user_id as senderUserId, u.name as senderName
       FROM ${table} m JOIN users u ON u.id = m.sender_user_id WHERE m.id = ?`
    )
    .get(result.lastInsertRowid);
}

export function markChatRead(userId, room, roomId) {
  db.prepare(
    `INSERT INTO chat_reads (user_id, room, room_id, last_read_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, room, room_id) DO UPDATE SET last_read_at = datetime('now')`
  ).run(userId, room, roomId);
}

export function lastReadAt(userId, room, roomId) {
  const row = db.prepare('SELECT last_read_at FROM chat_reads WHERE user_id = ? AND room = ? AND room_id = ?').get(userId, room, roomId);
  return row ? row.last_read_at : EPOCH;
}

export function unreadCount(room, roomId, senderExcludeUserId, since) {
  const table = MESSAGE_TABLES[room];
  const idColumn = ROOM_ID_COLUMNS[room];
  const { count } = db
    .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE ${idColumn} = ? AND sender_user_id != ? AND created_at > ?`)
    .get(roomId, senderExcludeUserId, since);
  return count;
}
