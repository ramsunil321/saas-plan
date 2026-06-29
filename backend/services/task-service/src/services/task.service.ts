// =============================================================================
// TASK SERVICE — Core business logic for task management
// =============================================================================
//
// RESPONSIBILITIES:
//   1. Orchestrate repository calls (task CRUD, assignee management)
//   2. Enforce business rules (e.g., can't move to non-existent board)
//   3. Write immutable activity logs on every mutation
//   4. Publish RabbitMQ events for the Notification Service
//   5. Invalidate Redis cache on writes
//
// ACTIVITY LOG STRATEGY:
//   Every state change writes an activity log entry. The log records:
//   - WHAT changed (action: 'task.status_changed')
//   - FROM what state (metadata: { from: 'todo', to: 'in_progress' })
//   - WHO made the change (actorId)
//   - WHEN (createdAt — auto-set by Prisma)
//
//   Activity logs are fire-and-forget (we don't await them in the response).
//   A logging failure should never fail the main operation.
//
// CACHE INVALIDATION:
//   On any task mutation, we invalidate:
//   - The specific task's cache key (org:{orgId}:task:{taskId})
//   - The board's task list cache (for the affected board)
//   - The project's task list cache
//
//   INTERVIEW QUESTION: "What cache entries need to be invalidated on a board move?"
//   Answer: THREE entries:
//   1. The task's individual cache (data changed)
//   2. The SOURCE board's task list (task no longer in it)
//   3. The TARGET board's task list (task was added to it)
//   Missing any one causes stale Kanban columns.
// =============================================================================

import { prisma } from '../config/database';
import { CacheKeys } from '../config/redis';
import { getOrFetch, invalidate, invalidateMany } from '../utils/cache';
import { logger } from '../utils/logger';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors';
import {
  ITaskRepository,
  IActivityRepository,
  SafeTask,
  TaskFilters,
  PaginationParams,
  PaginatedResult,
  CreateTaskData,
  UpdateTaskData,
  CreateActivityData,
} from '../interfaces/task.interface';
import {
  publishTaskCreated,
  publishTaskUpdated,
  publishTaskDeleted,
  publishTaskAssigned,
  publishTaskUnassigned,
  publishTaskStatusChanged,
  publishTaskCompleted,
  publishCommentAdded,
} from '../events/publishers/task.publisher';

export class TaskService {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly activityRepo: IActivityRepository,
  ) {}

  // ==========================================================================
  // CREATE TASK
  // ==========================================================================
  async createTask(
    organizationId: string,
    projectId: string,
    actorId: string,
    data: CreateTaskData,
  ): Promise<SafeTask> {
    // Verify the board belongs to this project (prevents cross-project board assignment)
    const board = await prisma.board.findFirst({
      where: { id: data.boardId, projectId, organizationId },
      select: { id: true, name: true },
    });

    if (!board) throw new NotFoundError('Board');

    const task = await this.taskRepo.create({
      ...data,
      organizationId,
      projectId,
      reporterId: actorId,
    });

    // Invalidate the board's task list cache (new task appeared)
    await invalidateMany([
      CacheKeys.boardTasks(organizationId, projectId, data.boardId),
      CacheKeys.projectTasks(organizationId, projectId),
    ]);

    // Write activity log (fire-and-forget — failures don't affect the response)
    this.logActivity({
      organizationId,
      entityType: 'task',
      entityId: task.id,
      action: 'task.created',
      actorId,
      metadata: { taskKey: task.taskKey, boardName: board.name, title: task.title },
    }).catch((err) => logger.error('[TaskService] Activity log failed', { err }));

    // Publish RabbitMQ event (fire-and-forget)
    publishTaskCreated(organizationId, actorId, {
      taskId: task.id,
      taskKey: task.taskKey,
      taskTitle: task.title,
      projectId,
      boardName: board.name,
    }).catch(() => {});

    logger.info('[TaskService] Task created', { taskId: task.id, taskKey: task.taskKey, actorId });

    return task;
  }

  // ==========================================================================
  // GET TASK
  // ==========================================================================
  async getTask(organizationId: string, taskId: string): Promise<SafeTask> {
    const cacheKey = CacheKeys.task(organizationId, taskId);

    const task = await getOrFetch(cacheKey, async () => {
      const found = await this.taskRepo.findById(organizationId, taskId);
      if (!found) throw new NotFoundError('Task');
      return found;
    });

    return task;
  }

  // ==========================================================================
  // LIST TASKS BY PROJECT
  // ==========================================================================
  async listByProject(
    organizationId: string,
    projectId: string,
    filters: TaskFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SafeTask>> {
    // Cache board-specific lists (no filters), but skip cache when filters are applied
    // Cached: /tasks?boardId=xxx (Kanban column view — very common)
    // Not cached: /tasks?search=bug&priority=high (filtered — too many variations)
    const hasBoardOnly = filters.boardId && Object.keys(filters).length === 1;

    if (hasBoardOnly && filters.boardId) {
      const cacheKey = CacheKeys.boardTasks(organizationId, projectId, filters.boardId);
      return getOrFetch(cacheKey, () =>
        this.taskRepo.listByProject(organizationId, projectId, filters, pagination),
      );
    }

    return this.taskRepo.listByProject(organizationId, projectId, filters, pagination);
  }

  // ==========================================================================
  // UPDATE TASK
  // ==========================================================================
  async updateTask(
    organizationId: string,
    taskId: string,
    actorId: string,
    data: UpdateTaskData,
  ): Promise<SafeTask> {
    const existing = await this.taskRepo.findById(organizationId, taskId);
    if (!existing) throw new NotFoundError('Task');

    await this.taskRepo.update(organizationId, taskId, data);

    // Invalidate all relevant cache keys
    await invalidateMany([
      CacheKeys.task(organizationId, taskId),
      CacheKeys.boardTasks(organizationId, existing.projectId, existing.boardId),
      CacheKeys.projectTasks(organizationId, existing.projectId),
    ]);

    // Track which fields changed for the activity log
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (data.title !== undefined && data.title !== existing.title) {
      changes.title = { from: existing.title, to: data.title };
    }
    if (data.priority !== undefined && data.priority !== existing.priority) {
      changes.priority = { from: existing.priority, to: data.priority };
    }
    if (data.dueDate !== undefined) {
      changes.dueDate = { from: existing.dueDate, to: data.dueDate };
    }

    if (Object.keys(changes).length > 0) {
      this.logActivity({
        organizationId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.updated',
        actorId,
        metadata: { changes, taskKey: existing.taskKey },
      }).catch((err) => logger.error('[TaskService] Activity log failed', { err }));

      publishTaskUpdated(organizationId, actorId, {
        taskId,
        taskKey: existing.taskKey,
        changes,
      }).catch(() => {});
    }

    // Return fresh task from DB
    const updated = await this.taskRepo.findById(organizationId, taskId);
    return updated!;
  }

  // ==========================================================================
  // DELETE TASK
  // ==========================================================================
  async deleteTask(organizationId: string, taskId: string, actorId: string): Promise<void> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    await this.taskRepo.delete(organizationId, taskId);

    await invalidateMany([
      CacheKeys.task(organizationId, taskId),
      CacheKeys.boardTasks(organizationId, task.projectId, task.boardId),
      CacheKeys.projectTasks(organizationId, task.projectId),
    ]);

    this.logActivity({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.deleted',
      actorId,
      metadata: { taskKey: task.taskKey, title: task.title },
    }).catch(() => {});

    publishTaskDeleted(organizationId, actorId, {
      taskId,
      taskKey: task.taskKey,
      taskTitle: task.title,
      projectId: task.projectId,
    }).catch(() => {});

    logger.info('[TaskService] Task deleted', { taskId, taskKey: task.taskKey, actorId });
  }

  // ==========================================================================
  // MOVE TASK (Board/Status Change)
  // ==========================================================================
  // Moving a task to a different board column = changing its status.
  // Example: dragging from "Todo" to "In Progress" column.
  //
  // INTERVIEW QUESTION: "How do you handle status changes in a Kanban board?"
  // Answer: Each column is a Board record. Moving a task updates its boardId
  // and denormalized status field. The activity log records the transition.
  // ==========================================================================
  async moveTask(
    organizationId: string,
    taskId: string,
    actorId: string,
    targetBoardId: string,
    position?: number,
  ): Promise<SafeTask> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    // Determine position in target board
    const newPosition = position ?? await this.taskRepo.getLastPositionInBoard(targetBoardId);

    if (task.boardId === targetBoardId) {
      // Reorder within the same board
      await this.taskRepo.reorder(organizationId, taskId, newPosition);

      // Invalidate cache for this board
      await invalidateMany([
        CacheKeys.task(organizationId, taskId),
        CacheKeys.boardTasks(organizationId, task.projectId, targetBoardId),
        CacheKeys.projectTasks(organizationId, task.projectId),
      ]);

      const updated = await this.taskRepo.findById(organizationId, taskId);
      return updated!;
    }

    // Verify target board exists and belongs to the same project
    const targetBoard = await prisma.board.findFirst({
      where: { id: targetBoardId, projectId: task.projectId, organizationId },
      select: { id: true, name: true },
    });

    if (!targetBoard) throw new NotFoundError('Target board');

    const previousBoardId = task.boardId;

    await this.taskRepo.move(organizationId, taskId, targetBoardId, newPosition);

    // Invalidate cache for BOTH source and target boards
    await invalidateMany([
      CacheKeys.task(organizationId, taskId),
      CacheKeys.boardTasks(organizationId, task.projectId, previousBoardId),
      CacheKeys.boardTasks(organizationId, task.projectId, targetBoardId),
      CacheKeys.projectTasks(organizationId, task.projectId),
    ]);

    // Check if the task is being completed (moved to "Done" board)
    const isDone = targetBoard.name.toLowerCase() === 'done';

    this.logActivity({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.status_changed',
      actorId,
      metadata: {
        from: task.status,
        to: targetBoard.name.toLowerCase().replace(/\s+/g, '_'),
        fromBoardId: previousBoardId,
        toBoardId: targetBoardId,
        taskKey: task.taskKey,
      },
    }).catch(() => {});

    publishTaskStatusChanged(organizationId, actorId, {
      taskId,
      taskKey: task.taskKey,
      taskTitle: task.title,
      fromBoardId: previousBoardId,
      toBoardId: targetBoardId,
      toBoardName: targetBoard.name,
      projectId: task.projectId,
    }).catch(() => {});

    // Additionally publish task.completed if moved to Done
    if (isDone) {
      publishTaskCompleted(organizationId, actorId, {
        taskId,
        taskKey: task.taskKey,
        taskTitle: task.title,
        projectId: task.projectId,
      }).catch(() => {});
    }

    const updated = await this.taskRepo.findById(organizationId, taskId);
    return updated!;
  }

  // ==========================================================================
  // REORDER TASK (Within Same Board)
  // ==========================================================================
  // Updates only the position field — used for drag-and-drop within a column.
  // Position is a Float computed by the client using fractional indexing.
  // ==========================================================================
  async reorderTask(
    organizationId: string,
    taskId: string,
    position: number,
  ): Promise<void> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    await this.taskRepo.reorder(organizationId, taskId, position);

    // Only invalidate the board's task list (position affects ordering, not the task itself)
    await invalidate(CacheKeys.boardTasks(organizationId, task.projectId, task.boardId));
  }

  // ==========================================================================
  // ASSIGN TASK
  // ==========================================================================
  async assignTask(
    organizationId: string,
    taskId: string,
    actorId: string,
    userIds: string[],
  ): Promise<SafeTask> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    // Check which users are already assigned (avoid duplicate assignee error)
    const existingAssigneeIds = task.assignees.map((a) => a.userId);

    for (const userId of userIds) {
      if (existingAssigneeIds.includes(userId)) {
        continue; // Skip already-assigned users
      }

      // Verify the user is a member of the organization before assigning
      const membership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId, userId },
        },
        select: { userId: true },
      });

      if (!membership) {
        throw new NotFoundError(`User ${userId} is not a member of this organization`);
      }

      await this.taskRepo.addAssignee(taskId, userId, actorId);

      this.logActivity({
        organizationId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.assigned',
        actorId,
        metadata: { assigneeId: userId, taskKey: task.taskKey },
      }).catch(() => {});

      publishTaskAssigned(organizationId, actorId, {
        taskId,
        taskKey: task.taskKey,
        taskTitle: task.title,
        assigneeId: userId,
        projectId: task.projectId,
      }).catch(() => {});
    }

    await invalidate(CacheKeys.task(organizationId, taskId));

    const updated = await this.taskRepo.findById(organizationId, taskId);
    return updated!;
  }

  // ==========================================================================
  // UNASSIGN TASK
  // ==========================================================================
  async unassignTask(
    organizationId: string,
    taskId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    const isAssigned = task.assignees.some((a) => a.userId === targetUserId);
    if (!isAssigned) {
      throw new NotFoundError('User assignment');
    }

    await this.taskRepo.removeAssignee(taskId, targetUserId);

    await invalidate(CacheKeys.task(organizationId, taskId));

    this.logActivity({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.unassigned',
      actorId,
      metadata: { removedUserId: targetUserId, taskKey: task.taskKey },
    }).catch(() => {});

    publishTaskUnassigned(organizationId, actorId, {
      taskId,
      taskKey: task.taskKey,
      removedUserId: targetUserId,
    }).catch(() => {});
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async logActivity(data: CreateActivityData): Promise<void> {
    await this.activityRepo.create(data);
  }
}
