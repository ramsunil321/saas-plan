// =============================================================================
// EXPRESS APPLICATION SETUP
// =============================================================================
//
// WHY THIS FILE EXISTS (and why it's separate from server.ts):
//   app.ts creates and configures the Express application.
//   server.ts imports the app and starts the HTTP server.
//
//   Separation allows integration tests to import `app` directly (without
//   starting a real server) and test routes with supertest.
//
// MIDDLEWARE REGISTRATION ORDER MATTERS:
//   1. Security headers (helmet) — first, before any processing
//   2. CORS — before any routes handle requests
//   3. Body parsing — so req.body is populated
//   4. Cookie parsing — so req.cookies is populated
//   5. Request logging — log every request
//   6. Routes — actual business logic
//   7. 404 handler — after all routes, catch unmatched paths
//   8. Error handler — MUST be last (4-argument signature)
//
// INTERVIEW QUESTION:
//   "What does helmet do?"
//   Answer: Sets security-related HTTP headers automatically:
//   - X-Content-Type-Options: nosniff (prevents MIME sniffing)
//   - X-Frame-Options: DENY (prevents clickjacking)
//   - X-XSS-Protection (browser XSS filter)
//   - Content-Security-Policy (controls allowed resource sources)
//   One line replaces manual configuration of ~15 headers.
//
// INTERVIEW QUESTION:
//   "What is CORS and why do we need it?"
//   Answer: Cross-Origin Resource Sharing. Browsers block JavaScript from
//   making requests to a different origin (domain/port/protocol) by default.
//   CORS headers tell the browser which origins are allowed.
//   The frontend (localhost:3000) needs permission to call the API (localhost:3001).
// =============================================================================

import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';
import { logger } from './utils/logger';

// Create the Express application
const app: Application = express();

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// Helmet: set security HTTP headers
app.use(helmet());

// Trust the first proxy (Nginx in our architecture)
// Required for req.ip to return the client's real IP (not the proxy's IP)
// INTERVIEW QUESTION: "What is a reverse proxy?"
// Answer: A server that sits between clients and backend servers.
// It receives all requests and forwards them to the appropriate backend.
// Nginx in our architecture is a reverse proxy: client → Nginx → Auth Service.
// Without trust proxy, req.ip = Nginx's IP, not the client's IP.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// CORS configuration
const allowedOrigins = [
  env.FRONTEND_URL,
  // Add more origins here for mobile apps, partner integrations, etc.
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    // Allow cookies to be sent cross-origin (for the refresh token cookie)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// =============================================================================
// BODY PARSING MIDDLEWARE
// =============================================================================

// Parse JSON bodies: {"email": "test@example.com"}
app.use(express.json({ limit: '10kb' })); // 10kb limit prevents large payload attacks

// Parse URL-encoded bodies: email=test%40example.com&password=abc
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Parse cookies: Cookie: refreshToken=eyJhbGci...
app.use(cookieParser());

// =============================================================================
// REQUEST LOGGING
// =============================================================================

// Morgan: HTTP request logger
// 'combined' format: Apache combined log format (standard for production)
// 'dev' format: colored, concise (good for development)
if (env.NODE_ENV !== 'test') {
  app.use(
    morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
      stream: {
        // Pipe Morgan output through Winston logger
        write: (message) => logger.http(message.trim()),
      },
    }),
  );
}

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
// Simple endpoint that load balancers and Docker health checks can ping
// Returns 200 if the server is up (doesn't check DB/Redis — that's readiness)
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth-service',
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// ROUTES
// =============================================================================

// All auth endpoints are prefixed with /api/v1/auth
// Final URL: http://localhost:3001/api/v1/auth/login, /api/v1/auth/register, etc.
// The /api/v1 prefix is the API version namespace — all services use it so that
// nginx can route by path and clients can call all services through the same origin.
app.use('/api/v1/auth', authRouter);

// =============================================================================
// ERROR HANDLING (must be last)
// =============================================================================

// 404: no route matched
app.use(notFoundMiddleware);

// Global error handler: catches all errors thrown/passed via next(error)
// Must have exactly 4 parameters for Express to recognize it as error middleware
app.use(errorMiddleware);

export default app;
