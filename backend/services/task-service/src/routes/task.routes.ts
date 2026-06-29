// =============================================================================
// TASK ROUTES — All task service endpoints
// =============================================================================
//
// ROUTE ORGANIZATION:
//   Tasks are always scoped to an organization (for tenant isolation).
//   Project-scoped routes (create, list) also include projectId.
//   Task-specific routes use taskId.
//
// MIDDLEWARE CHAIN (same pattern as workspace-service):
//   requireAuth → requireOrgMember → requirePermission(perm) → validate(schema) → controller
//
// FILE UPLOAD ARCHITECTURE (Multer):
//   The /attachments POST route uses multer before the controller.
//   Multer reads the multipart/form-data body, saves the file to disk,
//   and sets req.file with metadata (originalname, path, size, mimetype).
//   The controller then reads req.file to create the DB record.
//
// INTERVIEW QUESTION: "How does multer handle file uploads?"
//   Answer: Multer is a Node.js middleware for handling multipart/form-data.
//   It intercepts the request stream, parses the form data, and either:
//   - Saves files to disk (diskStorage) → req.file.path
//   - Keeps files in memory (memoryStorage) → req.file.buffer
//   diskStorage is better for large files; memoryStorage is faster for small files.
//   For production, use multer-s3 to stream directly to S3 without touching disk.
// =============================================================================

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';

// --- Dependency Injection (Manual) ---
import { TaskRepository } from '../repositories/task.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { ActivityRepository } from '../repositories/activity.repository';
import { TaskService } from '../services/task.service';
import { CommentService } from '../services/comment.service';
import { AttachmentService } from '../services/attachment.service';
import { TaskController } from '../controllers/task.controller';
import { CommentController } from '../controllers/comment.controller';
import { AttachmentController } from '../controllers/attachment.controller';

// --- Middlewares ---
import { requireAuth } from '../middlewares/auth.middleware';
import { requireOrgMember, requirePermission } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';

// --- Validators ---
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksSchema,
  moveTaskSchema,
  reorderTaskSchema,
  assignTaskSchema,
  unassignTaskSchema,
  createCommentSchema,
  updateCommentSchema,
  deleteCommentSchema,
  deleteAttachmentSchema,
} from '../validators/task.validator';

// =============================================================================
// DEPENDENCY INJECTION — Wire everything together
// =============================================================================
// Repository → Service → Controller (Clean Architecture dependency direction)

const taskRepo = new TaskRepository();
const commentRepo = new CommentRepository();
const attachmentRepo = new AttachmentRepository();
const activityRepo = new ActivityRepository();

const taskService = new TaskService(taskRepo, activityRepo);
const commentService = new CommentService(commentRepo, taskRepo, activityRepo);
const attachmentService = new AttachmentService(attachmentRepo, taskRepo, activityRepo);

const taskController = new TaskController(taskService);
const commentController = new CommentController(commentService);
const attachmentController = new AttachmentController(attachmentService);

// =============================================================================
// MULTER CONFIGURATION — Local disk storage for file uploads
// =============================================================================

const uploadDir = path.resolve(env.UPLOAD_DIR);

// Ensure the upload directory exists at startup
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  // Generate a unique filename to prevent collisions
  // Format: {uuid}-{timestamp}.{ext}
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}-${Date.now()}${ext}`;
    cb(null, uniqueName);
  },
});

// MIME type allowlist — reject disallowed file types before they touch disk
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, // Convert MB to bytes
    files: 1, // Allow only one file per request
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true); // Accept file
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

// =============================================================================
// ROUTER
// =============================================================================

export const taskRouter = Router();

// =============================================================================
// TASK CRUD ROUTES
// =============================================================================

// List tasks in a project (with optional filters: boardId, status, priority, etc.)
// GET /tasks/organizations/:orgId/projects/:projectId/tasks
taskRouter.get(
  '/organizations/:orgId/projects/:projectId/tasks',
  requireAuth,
  requireOrgMember,
  requirePermission('project:view'),
  validate(listTasksSchema),
  taskController.listByProject,
);

// Create a new task in a project
// POST /tasks/organizations/:orgId/projects/:projectId/tasks
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks',
  requireAuth,
  requireOrgMember,
  requirePermission('task:create'),
  validate(createTaskSchema),
  taskController.create,
);

// Get a single task with full details (assignees, counts)
// GET /organizations/:orgId/projects/:projectId/tasks/:taskId
taskRouter.get(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId',
  requireAuth,
  requireOrgMember,
  taskController.getById,
);

// Update task fields (title, description, priority, dueDate, etc.)
// PATCH /organizations/:orgId/projects/:projectId/tasks/:taskId
taskRouter.patch(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId',
  requireAuth,
  requireOrgMember,
  requirePermission('task:update'),
  validate(updateTaskSchema),
  taskController.update,
);

// Delete a task
// DELETE /organizations/:orgId/projects/:projectId/tasks/:taskId
taskRouter.delete(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId',
  requireAuth,
  requireOrgMember,
  requirePermission('task:delete'),
  taskController.delete,
);

// =============================================================================
// TASK BOARD MOVEMENT ROUTES
// =============================================================================

// Move task to a different board column (status change)
// POST /organizations/:orgId/projects/:projectId/tasks/:taskId/move
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/move',
  requireAuth,
  requireOrgMember,
  requirePermission('task:update'),
  validate(moveTaskSchema),
  taskController.move,
);

// Reorder task within the same board (drag-and-drop position update)
// POST /organizations/:orgId/projects/:projectId/tasks/:taskId/reorder
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/reorder',
  requireAuth,
  requireOrgMember,
  requirePermission('task:update'),
  validate(reorderTaskSchema),
  taskController.reorder,
);

// =============================================================================
// ASSIGNEE ROUTES
// =============================================================================

// Assign one or more users to a task
// POST /organizations/:orgId/projects/:projectId/tasks/:taskId/assignees
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/assignees',
  requireAuth,
  requireOrgMember,
  requirePermission('task:assign'),
  validate(assignTaskSchema),
  taskController.assign,
);

// Remove a specific user from task assignees
// DELETE /organizations/:orgId/projects/:projectId/tasks/:taskId/assignees/:userId
taskRouter.delete(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/assignees/:userId',
  requireAuth,
  requireOrgMember,
  requirePermission('task:assign'),
  validate(unassignTaskSchema),
  taskController.unassign,
);

// =============================================================================
// COMMENT ROUTES
// =============================================================================

// List all comments for a task (top-level + replies nested)
// GET /organizations/:orgId/projects/:projectId/tasks/:taskId/comments
taskRouter.get(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/comments',
  requireAuth,
  requireOrgMember,
  commentController.list,
);

// Add a comment to a task
// POST /organizations/:orgId/projects/:projectId/tasks/:taskId/comments
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/comments',
  requireAuth,
  requireOrgMember,
  requirePermission('comment:create'),
  validate(createCommentSchema),
  commentController.create,
);

// Edit a comment (author only — enforced in service layer)
// PATCH /organizations/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId
taskRouter.patch(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId',
  requireAuth,
  requireOrgMember,
  validate(updateCommentSchema),
  commentController.update,
);

// Delete a comment (author or manager+)
// DELETE /organizations/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId
taskRouter.delete(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/comments/:commentId',
  requireAuth,
  requireOrgMember,
  validate(deleteCommentSchema),
  commentController.delete,
);

// =============================================================================
// ATTACHMENT ROUTES
// =============================================================================

// List all attachments for a task
// GET /organizations/:orgId/projects/:projectId/tasks/:taskId/attachments
taskRouter.get(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/attachments',
  requireAuth,
  requireOrgMember,
  attachmentController.list,
);

// Upload a file attachment to a task
// POST /organizations/:orgId/projects/:projectId/tasks/:taskId/attachments
// Content-Type: multipart/form-data (field: "file")
taskRouter.post(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/attachments',
  requireAuth,
  requireOrgMember,
  requirePermission('task:update'),
  upload.single('file'), // multer processes the file before the controller
  attachmentController.upload,
);

// Delete a file attachment
// DELETE /organizations/:orgId/projects/:projectId/tasks/:taskId/attachments/:attachmentId
taskRouter.delete(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/attachments/:attachmentId',
  requireAuth,
  requireOrgMember,
  validate(deleteAttachmentSchema),
  attachmentController.delete,
);

// =============================================================================
// ACTIVITY LOG ROUTE
// =============================================================================

// Get the activity timeline for a task
// GET /organizations/:orgId/projects/:projectId/tasks/:taskId/activity
taskRouter.get(
  '/organizations/:orgId/projects/:projectId/tasks/:taskId/activity',
  requireAuth,
  requireOrgMember,
  taskController.getActivity,
);
