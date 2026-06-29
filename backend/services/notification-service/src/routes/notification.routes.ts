// =============================================================================
// NOTIFICATION ROUTES
// =============================================================================
//
// All routes require authentication (requireAuth).
// No RBAC/organization membership check needed — notifications are personal.
// Authorization is enforced at the repository level via recipientId.
//
// ROUTE MAP:
//   GET  /notifications                  → list (paginated)
//   GET  /notifications/unread-count     → badge count (cached)
//   PUT  /notifications/read-all         → bulk mark read
//   PUT  /notifications/:id/read         → mark single read
//   DELETE /notifications                → bulk delete all
//   DELETE /notifications/:id            → delete single
//
// ROUTE ORDER MATTERS:
//   Express matches routes in declaration order. '/read-all' must be declared
//   BEFORE '/:id' — otherwise ':id' would match the string "read-all" and
//   pass "read-all" as a UUID param, causing a validation error.
//   This is the classic "wildcard vs literal segment" ordering problem.
// =============================================================================

import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { NotificationService } from '../services/notification.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  listNotificationsSchema,
  unreadCountSchema,
  notificationParamsSchema,
  readAllSchema,
  deleteAllSchema,
} from '../validators/notification.validator';

// Dependency injection chain: Repository → Service → Controller
const repository = new NotificationRepository();
const service = new NotificationService(repository);
const controller = new NotificationController(service);

const router = Router();

// GET /notifications?orgId=&page=&limit=&isRead=
router.get(
  '/',
  requireAuth,
  validate(listNotificationsSchema),
  controller.list,
);

// GET /notifications/unread-count?orgId=
// MUST be before /:id to avoid "unread-count" being matched as a UUID param
router.get(
  '/unread-count',
  requireAuth,
  validate(unreadCountSchema),
  controller.getUnreadCount,
);

// PUT /notifications/read-all?orgId=
// MUST be before /:id/read for the same routing-order reason
router.put(
  '/read-all',
  requireAuth,
  validate(readAllSchema),
  controller.markAllAsRead,
);

// PUT /notifications/:id/read?orgId=
router.put(
  '/:id/read',
  requireAuth,
  validate(notificationParamsSchema),
  controller.markAsRead,
);

// DELETE /notifications?orgId= (bulk delete)
router.delete(
  '/',
  requireAuth,
  validate(deleteAllSchema),
  controller.deleteAll,
);

// DELETE /notifications/:id?orgId= (single delete)
router.delete(
  '/:id',
  requireAuth,
  validate(notificationParamsSchema),
  controller.delete,
);

export default router;

// Re-export for dependency injection in tests
export { service as notificationService };
