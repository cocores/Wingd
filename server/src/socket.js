import { Server } from 'socket.io';
import { verifyToken } from './middleware/auth.js';
import { TERMINAL_STATUSES, getMatchById, isPilotOfMatch, insertMessage } from './routes/matches.js';
import { getInterestById, hasInterestAccess } from './routes/interests.js';

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
    socket.on('join-copilot-room', ({ interestId }, ack) => {
      const interest = getInterestById(interestId);
      if (!interest || !hasInterestAccess(socket.userId, interest)) {
        return ack?.({ error: 'Not authorized for this wing chat' });
      }
      socket.join(`copilot-${interestId}`);
      ack?.({ ok: true });
    });

    socket.on('copilot-message', ({ interestId, body }, ack) => {
      const interest = getInterestById(interestId);
      if (!interest || !hasInterestAccess(socket.userId, interest)) {
        return ack?.({ error: 'Not authorized for this wing chat' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const row = insertMessage('copilot', interestId, socket.userId, body.trim());
      io.to(`copilot-${interestId}`).emit('copilot-message', row);
      ack?.({ ok: true, message: row });
    });

    socket.on('join-pilot-room', ({ matchId }, ack) => {
      const match = getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || TERMINAL_STATUSES.includes(match.status)) {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      socket.join(`pilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('pilot-message', ({ matchId, body }, ack) => {
      const match = getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || TERMINAL_STATUSES.includes(match.status)) {
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
