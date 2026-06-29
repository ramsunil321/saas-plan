// =============================================================================
// TASK SERVICE — Express Application Setup
// =============================================================================
//
// STATIC FILE SERVING:
//   The /uploads route serves uploaded attachments directly.
//   In production, this would be replaced by S3 presigned URLs —
//   files would be served by CloudFront/S3, not your backend.
//   Serving static files through Express is fine for development but
//   adds unnecessary load in production (S3 scales better and is cheaper).
// =============================================================================

import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { rootRouter } from './routes/index';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';
import { logger } from './utils/logger';

const app: Application = express();

// Security headers — sets X-Content-Type-Options, X-Frame-Options, etc.
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

// Body parser — limit 10kb for JSON requests
// NOTE: multipart/form-data (file uploads) is NOT parsed by express.json()
// It is handled by multer middleware on the specific upload route
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// HTTP request logging (skip in test environment to keep test output clean)
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// Serve uploaded files as static assets
// In production: replace with S3 presigned URL redirect
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));

// Health check — used by Docker HEALTHCHECK and load balancers
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'task-service',
    timestamp: new Date().toISOString(),
  });
});

// All task routes prefixed with /api/v1
// rootRouter → taskRouter has /organizations/:orgId/projects/:projectId/tasks/...
// Final paths: /api/v1/organizations/:orgId/projects/:projectId/tasks/*
// This matches the nginx regex and the frontend taskClient base URL.
app.use('/api/v1', rootRouter);

// 404 handler (must be before error handler)
app.use(notFoundMiddleware);

// Global error handler (must be last — 4-argument signature is required by Express)
app.use(errorMiddleware);

export default app;
