import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import copilotRoutes from './routes/copilots.js';
import matchRoutes from './routes/matches.js';
import interestRoutes from './routes/interests.js';
import notificationRoutes from './routes/notifications.js';
import geoRoutes from './routes/geo.js';
import billingRoutes, { handleWebhook } from './routes/billing.js';
import { attachSocket } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: clientOrigin, credentials: true }));

// Stripe's webhook signature check needs the raw body, so this must be
// registered before express.json() parses (and discards) it.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/copilots', copilotRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api', matchRoutes);
app.use('/api', interestRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Express 4 doesn't route a rejected promise from an async handler to the
// error middleware above unless the handler explicitly catches and calls
// next(err) — an uncaught one is an unhandled rejection, which crashes the
// whole process by default. Log and carry on instead: one bad request (a
// corrupt upload, a downstream API hiccup) should never take the server
// down for everyone else.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (recovered):', err);
});

const httpServer = createServer(app);
attachSocket(httpServer, clientOrigin);

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`Wingd server listening on http://localhost:${port}`);
});
