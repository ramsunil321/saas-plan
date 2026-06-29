// =============================================================================
// TASK VALIDATORS — Zod schemas for all task service endpoints
// =============================================================================
//
// WHY ZOD?
//   TypeScript types are erased at runtime — req.body is just 'any'.
//   Zod validates at runtime AND generates TypeScript types via z.infer<>.
//   Single source of truth: change the schema, the type updates automatically.
//
// PATTERN: Every schema validates { body, query, params } together.
//   This prevents params/body mismatch bugs (e.g., taskId in params vs body).
//
// INTERVIEW QUESTION: "What is schema-first validation?"
//   Answer: Define the data shape first (Zod schema), then derive types from it.
//   The reverse (types first, then write validators to match) causes drift.
// =============================================================================

import { z } from 'zod';

// =============================================================================
// SHARED SCHEMAS — Reused across multiple route schemas
// =============================================================================

const uuidParam = z.string().uuid('Invalid ID format');

const paginationQuery = z.object({
  page:  z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(1000)).default('20'),
});

// Task priority levels — must match DB constraint
const priorityEnum = z.enum(['low', 'medium', 'high', 'urgent'], {
  errorMap: () => ({ message: 'Priority must be one of: low, medium, high, urgent' }),
});

// =============================================================================
// TASK SCHEMAS
// =============================================================================

export const createTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    projectId: uuidParam,
  }),
  body: z.object({
    title: z.string().trim().min(1, 'Title is required').max(500, 'Title must not exceed 500 characters'),
    description: z.string().trim().max(10000, 'Description too long').optional(),
    boardId: uuidParam,  // Which column (board) to place the task in
    priority: priorityEnum.default('medium'),
    dueDate: z
      .string()
      .datetime({ message: 'Due date must be a valid ISO 8601 datetime' })
      .optional()
      .transform((d) => (d ? new Date(d) : undefined)),
    estimatedHours: z.number().positive('Estimated hours must be positive').max(9999).optional(),
    parentTaskId: uuidParam.optional(),
    assigneeIds: z.array(uuidParam).max(10, 'Cannot assign more than 10 users at once').optional(),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
  body: z.object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    priority: priorityEnum.optional(),
    dueDate: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .transform((d) => (d ? new Date(d) : d === null ? null : undefined)),
    estimatedHours: z.number().positive().max(9999).nullable().optional(),
    actualHours: z.number().nonnegative().max(9999).optional(),
    parentTaskId: uuidParam.nullable().optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' },
  ),
});

export const listTasksSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    projectId: uuidParam,
  }),
  query: paginationQuery.extend({
    boardId: uuidParam.optional(),
    status: z.string().optional(),
    priority: priorityEnum.optional(),
    assigneeId: uuidParam.optional(),
    search: z.string().max(200).optional(),
    dueDate: z.string().datetime().optional(),
  }),
});

// Move task to a different board column
// This triggers a status change and activity log entry
export const moveTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
  body: z.object({
    targetBoardId: uuidParam,
    // Position in the new board — null means append to end
    position: z.number().optional(),
  }),
});

// Reorder task within the SAME board using fractional indexing
// The client computes the new position based on its UI state
//
// INTERVIEW QUESTION: "What is fractional indexing?"
// Answer: Tasks have float positions (1.0, 2.0, 3.0...).
// When you drag task between positions 2.0 and 3.0, set position = 2.5.
// Only ONE DB UPDATE needed (vs updating all subsequent rows with integers).
// Eventually positions converge to unrepresentable floats (e.g., 2.5000000001),
// requiring a full re-index. Use strings like LexoRank for infinite precision.
export const reorderTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
  body: z.object({
    position: z.number().finite('Position must be a finite number'),
  }),
});

// Assign one or more users to a task
export const assignTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
  body: z.object({
    userIds: z.array(uuidParam).min(1, 'At least one user ID required').max(10),
  }),
});

export const unassignTaskSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
    userId: uuidParam,
  }),
});

// =============================================================================
// COMMENT SCHEMAS
// =============================================================================

export const createCommentSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
  body: z.object({
    content: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
    // Optional: reply to another comment (threaded comments)
    parentId: uuidParam.optional(),
  }),
});

export const updateCommentSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
    commentId: uuidParam,
  }),
  body: z.object({
    content: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
  }),
});

export const deleteCommentSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
    commentId: uuidParam,
  }),
});

// =============================================================================
// ATTACHMENT SCHEMAS
// =============================================================================
// Note: file upload validation (size, MIME type) is handled by multer middleware.
// These schemas only validate URL params.

export const listAttachmentsSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
  }),
});

export const deleteAttachmentSchema = z.object({
  params: z.object({
    orgId: uuidParam,
    taskId: uuidParam,
    attachmentId: uuidParam,
  }),
});

// =============================================================================
// INFERRED TYPES — Derive TypeScript types from Zod schemas
// =============================================================================

export type CreateTaskBody = z.infer<typeof createTaskSchema>['body'];
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>['body'];
export type ListTasksQuery = z.infer<typeof listTasksSchema>['query'];
export type MoveTaskBody = z.infer<typeof moveTaskSchema>['body'];
export type ReorderTaskBody = z.infer<typeof reorderTaskSchema>['body'];
export type AssignTaskBody = z.infer<typeof assignTaskSchema>['body'];
export type CreateCommentBody = z.infer<typeof createCommentSchema>['body'];
export type UpdateCommentBody = z.infer<typeof updateCommentSchema>['body'];
