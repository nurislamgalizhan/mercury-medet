import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { initSocket } from './socket/index.js';
import { prisma } from './db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startDailyExpiredVisitsCleanupJob } from './utils/subscription.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import sectionRoutes from './routes/sections.js';
import tariffRoutes from './routes/tariffs.js';
import visitRoutes from './routes/visits.js';
import saleRoutes from './routes/sales.js';
import syncRoutes from './routes/sync.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

initSocket(io);

app.disable('x-powered-by');
startDailyExpiredVisitsCleanupJob(prisma);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '16kb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/tariffs', tariffRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/sync', syncRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
