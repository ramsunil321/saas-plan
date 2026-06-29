// =============================================================================
// LOGGER — Winston structured logging
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   console.log() is fine for learning but inadequate for production:
//   - No log levels (debug vs info vs error)
//   - No structured output (makes logs hard to query in tools like Datadog/ELK)
//   - No timestamps
//   - No request correlation IDs
//   - Synchronous (blocks the event loop on I/O)
//
//   Winston solves all of this. It's the most widely used Node.js logger.
//
// HOW IT WORKS:
//   - In development: human-readable colorized output with timestamps
//   - In production: JSON output (machine-readable, ingestible by log aggregators)
//   - Log levels: error > warn > info > http > debug
//     (setting level to 'info' means error+warn+info are logged, debug is not)
//
// INTERVIEW QUESTION:
//   "What is structured logging?"
//   Answer: Instead of plain text strings, log entries are JSON objects with
//   consistent fields (timestamp, level, message, requestId, userId, etc.).
//   This makes logs queryable: "show all errors for user X in the last hour."
//   Tools like Elasticsearch, Datadog, and Splunk can index and search JSON
//   logs efficiently. Plain text requires regex, which is slow and fragile.
// =============================================================================

import winston from 'winston';
import { env } from '../config/env';

const { combine, timestamp, colorize, printf, json, errors } = winston.format;

// Custom format for development — human-readable with colors
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }), // Include stack traces for Error objects
  printf(({ level, message, timestamp, stack, ...meta }) => {
    // Print metadata (requestId, userId, etc.) if present
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    // If this is an Error, show the stack trace
    return `${timestamp} [${level}]: ${stack ?? message}${metaStr}`;
  }),
);

// JSON format for production — machine-readable
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(), // Output each log line as a JSON object
);

export const logger = winston.createLogger({
  // Log level hierarchy: error > warn > info > http > verbose > debug > silly
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',

  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,

  // Named transports — you can have different log levels per transport
  transports: [
    // Always log to console (captured by Docker, systemd, etc.)
    new winston.transports.Console(),
  ],

  // Don't crash the process on unhandled logger errors
  exitOnError: false,
});

// HTTP request logger — used in Express middleware
// Logs every incoming request with method, url, status, and response time
export const httpLogger = {
  log: (message: string, meta?: object) => {
    logger.http(message, meta);
  },
};
