// =============================================================================
// WORKSPACE SERVICE — Express Application Setup
// =============================================================================
import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { workspaceRouter } from './routes/index';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';
import { logger } from './utils/logger';

const app: Application = express();

// Security headers
app.use(helmet());

if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'workspace-service', timestamp: new Date().toISOString() });
});

// All workspace routes prefixed with /api/v1
// workspaceRouter mounts /organizations, /teams, etc. so final paths are:
// /api/v1/organizations/*, /api/v1/organizations/:orgId/projects/*, etc.
// This matches what nginx proxies and what the frontend client calls.
app.use('/api/v1', workspaceRouter);

// Error handling (must be last)
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
