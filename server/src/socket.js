import { Server } from 'socket.io';
import { verifyToken } from './middleware/auth.js';
import { TERMINAL_STATUSES, getMatchById, canAccessCopilotRoom, isPilotOfMatch, insertMessage } from './routes/matches.js';

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
      const match = getMatchById(matchId);
      if (!match || !canAccessCopilotRoom(socket.userId, match)) {
        return ack?.({ error: 'Not authorized for this co-pilot room' });
      }
      socket.join(`copilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('copilot-message', ({ matchId, body }, ack) => {
      const match = getMatchById(matchId);
      if (!match || !canAccessCopilotRoom(socket.userId, match)) {
        return ack?.({ error: 'Not authorized for this co-pilot room' });
      }
      if (TERMINAL_STATUSES.includes(match.status)) {
        return ack?.({ error: 'This match has ended' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const row = insertMessage('copilot', matchId, socket.userId, body.trim());
      io.to(`copilot-${matchId}`).emit('copilot-message', row);
      ack?.({ ok: true, message: row });
    });

    socket.on('join-pilot-room', ({ matchId }, ack) => {
      const match = getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || match.status !== 'approved') {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      socket.join(`pilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('pilot-message', ({ matchId, body }, ack) => {
      const match = getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || match.status !== 'approved') {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const row = insertMessage('pilot', matchId, socket.userId, body.trim());
      io.to(`pilot-${matchId}`).emit('pilot-message', row);
      ack?.({ ok: true, message: row });
    });
  });

  return io;
}
