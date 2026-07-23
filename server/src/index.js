import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import copilotRoutes from './routes/copilots.js';
import matchRoutes from './routes/matches.js';
import { attachSocket } from './socket.js';

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/copilots', copilotRoutes);
app.use('/api', matchRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = createServer(app);
attachSocket(httpServer, clientOrigin);

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`Wingd server listening on http://localhost:${port}`);
});
