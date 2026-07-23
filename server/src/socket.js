import { Server } from 'socket.io';
import db from './db.js';
import { verifyToken } from './middleware/auth.js';
import { canAccessCopilotRoom, isPilotOfMatch } from './routes/matches.js';

export function attachSocket(httpServer, clientOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = verifyToken(token);
      socket.userId = payload.id;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-copilot-room', ({ matchId }, ack) => {
      const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
      if (!match || !canAccessCopilotRoom(socket.userId, match)) {
        return ack?.({ error: 'Not authorized for this co-pilot room' });
      }
      socket.join(`copilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('copilot-message', ({ matchId, body }, ack) => {
      const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
      if (!match || !canAccessCopilotRoom(socket.userId, match)) {
        return ack?.({ error: 'Not authorized for this co-pilot room' });
      }
      if (match.status === 'rejected' || match.status === 'unmatched') {
        return ack?.({ error: 'This match has ended' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const result = db
        .prepare('INSERT INTO copilot_messages (match_id, sender_user_id, body) VALUES (?, ?, ?)')
        .run(matchId, socket.userId, body.trim());
      const row = db
        .prepare(
          `SELECT cm.id, cm.body, cm.created_at as createdAt, cm.sender_user_id as senderUserId, u.name as senderName
           FROM copilot_messages cm JOIN users u ON u.id = cm.sender_user_id WHERE cm.id = ?`
        )
        .get(result.lastInsertRowid);

      io.to(`copilot-${matchId}`).emit('copilot-message', row);
      ack?.({ ok: true, message: row });
    });

    socket.on('join-pilot-room', ({ matchId }, ack) => {
      const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || match.status !== 'approved') {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      socket.join(`pilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('pilot-message', ({ matchId, body }, ack) => {
      const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || match.status !== 'approved') {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const result = db
        .prepare('INSERT INTO pilot_messages (match_id, sender_user_id, body) VALUES (?, ?, ?)')
        .run(matchId, socket.userId, body.trim());
      const row = db
        .prepare(
          `SELECT pm.id, pm.body, pm.created_at as createdAt, pm.sender_user_id as senderUserId, u.name as senderName
           FROM pilot_messages pm JOIN users u ON u.id = pm.sender_user_id WHERE pm.id = ?`
        )
        .get(result.lastInsertRowid);

      io.to(`pilot-${matchId}`).emit('pilot-message', row);
      ack?.({ ok: true, message: row });
    });
  });

  return io;
}
