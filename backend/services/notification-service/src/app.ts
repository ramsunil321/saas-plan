// =============================================================================
// NOTIFICATION SERVICE — Express Application
// =============================================================================
//
// This file configures the Express app: security headers, middleware stack,
// routes, and error handling.
//
// WHAT THIS SERVICE EXPOSES via HTTP:
//   REST API for the frontend to:
//     - List notifications (paginated)
//     - Get unread badge count (Redis-cached)
//     - Mark notifications as read
//     - Delete notifications
//
// WHAT THIS SERVICE DOES SEPARATELY (not Express):
//   RabbitMQ consumer — see server.ts where EventConsumer is started.
//   The consumer and the HTTP server run concurrently in the same process.
//
// WHY SAME PROCESS?
//   Simpler deployment. One Docker container handles both the consumer and the
//   HTTP API. In high-scale systems, you'd separate them: dedicated consumer
//   workers and dedicated API servers, scaled independently. For FlowForge MVP,
//   one process per service is sufficient.
//
// SECURITY HEADERS (helmet):
//   Sets HTTP response headers to protect against common web attacks:
//   - Content-Security-Policy: prevents XSS script injection
//   - X-Frame-Options: prevents clickjacking
//   - X-Content-Type-Options: prevents MIME sniffing
//   Helmet is a meta-package that applies ~15 security headers with safe defaults.
// =============================================================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './utils/logger';
import routes from './routes';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';

const app = express();

// =============================================================================
// SECURITY & PARSING MIDDLEWARE
// =============================================================================

// Security headers — must be first in the middleware chain
app.use(helmet());

// CORS — allow the frontend origin to call this API
// In production, replace '*' with the exact frontend domain
app.use(cors({
  origin: env.NODE_ENV === 'production'
    ? env.FRONTEND_URL
    : '*',
  credentials: true,
}));

// Body parsers — parse JSON and URL-encoded bodies
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// REQUEST LOGGING
// =============================================================================
// Morgan streams HTTP access logs through Winston for unified log format.
// 'short' format: METHOD URL STATUS RESPONSE_TIME — concise for high traffic
// =============================================================================
app.use(
  morgan('short', {
    stream: {
      write: (message: string) => logger.http(message.trim()),
    },
    // Skip health check logs to avoid noise — health is checked every ~10s by load balancers
    skip: (req) => req.url === '/health',
  }),
);

// =============================================================================
// HEALTH CHECK — Required by Docker/Kubernetes liveness probes
// =============================================================================
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// API ROUTES
// =============================================================================
// All notification endpoints are prefixed with /api/v1
// This versioning strategy allows deploying v2 alongside v1 with zero downtime
// =============================================================================
app.use('/api/v1', routes);

// =============================================================================
// ERROR HANDLING — Must be LAST in the middleware chain
// =============================================================================
// Express identifies error-handling middleware by its 4-argument signature:
// (error, req, res, next). notFoundMiddleware handles unmatched routes.
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export { app };
