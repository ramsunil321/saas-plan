// =============================================================================
// NOTIFICATION VALIDATORS — Zod schemas for all API endpoints
// =============================================================================
//
// WHY ZOD INSTEAD OF JOI / CLASS-VALIDATOR?
//   Zod is TypeScript-first: it infers TypeScript types from schemas.
//   No duplication between "schema" and "interface" — one definition serves both.
//   class-validator requires decorators + reflect-metadata (more boilerplate).
//   Joi is JavaScript-first and requires manual TypeScript type inference.
//
// NOTIFICATION API ENDPOINTS:
//   GET  /notifications              → listNotificationsSchema (query params)
//   PUT  /notifications/:id/read     → notificationParamsSchema (just the id)
//   PUT  /notifications/read-all     → readAllSchema (orgId in query)
//   GET  /notifications/unread-count → unreadCountSchema (orgId in query)
//   DEL  /notifications/:id          → notificationParamsSchema
//   DEL  /notifications              → deleteAllSchema (orgId in query, for bulk clear)
// =============================================================================

import { z } from 'zod';

// Shared UUID validator for route params
const uuidParam = z.string().uuid('Must be a valid UUID');

// =============================================================================
// LIST NOTIFICATIONS — GET /notifications
// =============================================================================
// Returns paginated notifications for the authenticated user in an org.
// `isRead` optional filter: omit = all, "true" = read only, "false" = unread only
// =============================================================================
export const listNotificationsSchema = z.object({
  query: z.object({
    orgId: uuidParam,
    page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
    limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('20'),
    // String comparison because query params are always strings before parsing
    isRead: z.enum(['true', 'false']).optional().transform((v) => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }),
  }),
});

// =============================================================================
// UNREAD COUNT — GET /notifications/unread-count
// =============================================================================
export const unreadCountSchema = z.object({
  query: z.object({
    orgId: uuidParam,
  }),
});

// =============================================================================
// SINGLE NOTIFICATION PARAMS — used by mark-read, delete endpoints
// =============================================================================
export const notificationParamsSchema = z.object({
  params: z.object({
    id: uuidParam,
  }),
});

// =============================================================================
// MARK ALL READ — PUT /notifications/read-all
// =============================================================================
export const readAllSchema = z.object({
  query: z.object({
    orgId: uuidParam,
  }),
});

// =============================================================================
// DELETE ALL — DELETE /notifications
// =============================================================================
export const deleteAllSchema = z.object({
  query: z.object({
    orgId: uuidParam,
  }),
});

// Inferred TypeScript types for use in controllers
export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>['query'];
export type UnreadCountQuery = z.infer<typeof unreadCountSchema>['query'];
export type NotificationParams = z.infer<typeof notificationParamsSchema>['params'];
