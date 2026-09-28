import { Server } from 'socket.io';
import { verifyToken } from './middleware/auth.js';
import { TERMINAL_STATUSES, getMatchById, isPilotOfMatch, insertMessage } from './routes/matches.js';
import { getInterestById, hasInterestAccess } from './routes/interests.js';
import { getAcceptedWingIds } from './lib/circles.js';
import { sendPushToUser, sendPushToUsers } from './lib/push.js';

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
    socket.on('join-copilot-room', async ({ interestId }, ack) => {
      const interest = await getInterestById(interestId);
      if (!interest || !(await hasInterestAccess(socket.userId, interest))) {
        return ack?.({ error: 'Not authorized for this wing chat' });
      }
      socket.join(`copilot-${interestId}`);
      ack?.({ ok: true });
    });

    socket.on('copilot-message', async ({ interestId, body }, ack) => {
      const interest = await getInterestById(interestId);
      if (!interest || !(await hasInterestAccess(socket.userId, interest))) {
        return ack?.({ error: 'Not authorized for this wing chat' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const row = await insertMessage('copilot', interestId, socket.userId, body.trim());
      io.to(`copilot-${interestId}`).emit('copilot-message', row);
      ack?.({ ok: true, message: row });

      const wingIds = await getAcceptedWingIds(interest.fromUserId);
      const recipients = [...wingIds, interest.fromUserId].filter((id) => id !== socket.userId);
      await sendPushToUsers(recipients, { title: `${row.senderName} in the wing chat`, body: row.body, url: `/interests/${interestId}/chat` });
    });

    socket.on('join-pilot-room', async ({ matchId }, ack) => {
      const match = await getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || TERMINAL_STATUSES.includes(match.status)) {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      socket.join(`pilot-${matchId}`);
      ack?.({ ok: true });
    });

    socket.on('pilot-message', async ({ matchId, body }, ack) => {
      const match = await getMatchById(matchId);
      if (!match || !isPilotOfMatch(socket.userId, match) || TERMINAL_STATUSES.includes(match.status)) {
        return ack?.({ error: 'Not authorized for this chat yet' });
      }
      if (!body || !body.trim()) return ack?.({ error: 'Message body required' });

      const row = await insertMessage('pilot', matchId, socket.userId, body.trim());
      io.to(`pilot-${matchId}`).emit('pilot-message', row);
      ack?.({ ok: true, message: row });

      const otherPilotId = match.pilotAId === socket.userId ? match.pilotBId : match.pilotAId;
      await sendPushToUser(otherPilotId, { title: row.senderName, body: row.body, url: `/matches/${matchId}/pilot-chat` });
    });
  });

  return io;
}
