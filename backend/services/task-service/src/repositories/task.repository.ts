// =============================================================================
// TASK REPOSITORY — Data access layer for tasks
// =============================================================================
//
// RESPONSIBILITIES:
//   - All Prisma queries for the Task model
//   - Implements ITaskRepository interface (enables mock injection in tests)
//   - Every query is TENANT-SCOPED: always includes organizationId filter
//
// KEY PATTERNS:
//   1. Tenant isolation: every findFirst/findMany includes { where: { organizationId } }
//   2. Fractional indexing: getLastPositionInBoard returns max(position) + GAP
//   3. Task number: getNextTaskNumber uses aggregate MAX + 1 (atomic in transaction)
//   4. Denormalized project key: stored in tasks table via JOIN on create
//
// INTERVIEW QUESTION: "Why denormalize organizationId onto Task?"
//   Answer: Without organizationId on Task, every task query would need to JOIN
//   to projects table to verify tenant ownership. Denormalization adds a column
//   but eliminates JOINs for the most common queries, improving performance.
//   The tradeoff: if a project moves orgs (rare), the task rows need updating too.
// =============================================================================

import { prisma } from '../config/database';
import { Task, TaskAssignee } from '@prisma/client';
import {
  ITaskRepository,
  SafeTask,
  SafeTaskAssignee,
  CreateTaskData,
  UpdateTaskData,
  TaskFilters,
  PaginationParams,
  PaginatedResult,
} from '../interfaces/task.interface';

// Position gap for new items appended at the end.
// Using 65536 (2^16) provides a large initial gap that allows many insertions
// before fractional values become too small. Linear uses a similar strategy.
const POSITION_GAP = 65536;

export class TaskRepository implements ITaskRepository {

  // ==========================================================================
  // TASK QUERIES
  // ==========================================================================

  async findById(organizationId: string, taskId: string): Promise<SafeTask | null> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId }, // Tenant-scoped
      include: {
        // Load assignees with their user info for the response
        assignees: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
        // Load the project to get the key for building "FF-42" style identifier
        project: { select: { key: true } },
      },
    });

    if (!task) return null;
    return this.toSafeTask(task);
  }

  async listByProject(
    organizationId: string,
    projectId: string,
    filters: TaskFilters,
    { page, limit }: PaginationParams,
  ): Promise<PaginatedResult<SafeTask>> {
    const skip = (page - 1) * limit;

    // Build dynamic WHERE clause based on provided filters
    const where = {
      organizationId,
      projectId,
      ...(filters.boardId && { boardId: filters.boardId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.reporterId && { reporterId: filters.reporterId }),
      ...(filters.assigneeId && {
        // Filter by assignee using a relation filter — checks junction table
        assignees: { some: { userId: filters.assigneeId } },
      }),
      ...(filters.search && {
        // Case-insensitive title search using Prisma's 'contains' with 'mode: insensitive'
        // In production, consider PostgreSQL full-text search (tsvector) for better performance
        title: { contains: filters.search, mode: 'insensitive' as const },
      }),
      ...(filters.dueDate && {
        // Get tasks due ON OR BEFORE the given date
        dueDate: { lte: new Date(filters.dueDate) },
      }),
    };

    // Run count and data queries in parallel — same pattern as project.repository.ts
    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        include: {
          assignees: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
            },
          },
          project: { select: { key: true } },
        },
        orderBy: [
          { boardId: 'asc' },  // Group by board
          { position: 'asc' }, // Within board, sort by position (drag-and-drop order)
        ],
        take: limit,
        skip,
      }),
    ]);

    return {
      data: tasks.map((t) => this.toSafeTask(t)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async listByBoard(
    organizationId: string,
    boardId: string,
    { page, limit }: PaginationParams,
  ): Promise<PaginatedResult<SafeTask>> {
    const skip = (page - 1) * limit;

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where: { organizationId, boardId } }),
      prisma.task.findMany({
        where: { organizationId, boardId },
        include: {
          assignees: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
            },
          },
          project: { select: { key: true } },
        },
        // Tasks in a board are sorted by position for Kanban order
        orderBy: { position: 'asc' },
        take: limit,
        skip,
      }),
    ]);

    return {
      data: tasks.map((t) => this.toSafeTask(t)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ==========================================================================
  // TASK MUTATIONS
  // ==========================================================================

  async create(data: CreateTaskData): Promise<SafeTask> {
    // Get the next task number for this project (project-scoped sequence)
    const taskNumber = await this.getNextTaskNumber(data.projectId);

    // Determine position: place new task at the end of the board
    const position = data.position ?? await this.getLastPositionInBoard(data.boardId);

    const task = await prisma.task.create({
      data: {
        organizationId: data.organizationId,
        projectId: data.projectId,
        boardId: data.boardId,
        title: data.title,
        description: data.description,
        taskNumber,
        priority: data.priority ?? 'medium',
        status: 'todo', // Initial status — will be updated when moved between boards
        dueDate: data.dueDate,
        reporterId: data.reporterId,
        position,
        estimatedHours: data.estimatedHours,
        parentTaskId: data.parentTaskId,
        // Create initial assignees in the same operation (atomic)
        assignees: data.assigneeIds ? {
          create: data.assigneeIds.map((userId) => ({
            userId,
            assignedBy: data.reporterId,
          })),
        } : undefined,
      },
      include: {
        assignees: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          },
        },
        project: { select: { key: true } },
      },
    });

    return this.toSafeTask(task);
  }

  async update(organizationId: string, taskId: string, data: UpdateTaskData): Promise<Task> {
    return prisma.task.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
        ...(data.estimatedHours !== undefined && { estimatedHours: data.estimatedHours }),
        ...(data.actualHours !== undefined && { actualHours: data.actualHours }),
        ...(data.parentTaskId !== undefined && { parentTaskId: data.parentTaskId }),
      },
    });
  }

  async delete(organizationId: string, taskId: string): Promise<void> {
    // deleteMany instead of delete so we can include organizationId in the WHERE
    // clause for tenant safety. prisma.task.delete({ where: { id } }) only supports
    // unique fields in the where clause.
    await prisma.task.deleteMany({ where: { id: taskId, organizationId } });
  }

  // Move task to a different board — this is how "status changes" work
  // Moving from "Todo" board to "In Progress" board = status change
  async move(organizationId: string, taskId: string, targetBoardId: string, position: number): Promise<Task> {
    // Fetch the target board name to update the denormalized `status` field
    const targetBoard = await prisma.board.findFirst({
      where: { id: targetBoardId, organizationId },
      select: { name: true },
    });

    return prisma.task.update({
      where: { id: taskId },
      data: {
        boardId: targetBoardId,
        position,
        // Denormalize the board name as status for easy filtering
        // This prevents needing a JOIN to the boards table for status-based queries
        status: targetBoard?.name.toLowerCase().replace(/\s+/g, '_') ?? 'unknown',
      },
    });
  }

  // Reorder a task WITHIN the same board (only updates position)
  async reorder(organizationId: string, taskId: string, position: number): Promise<void> {
    await prisma.task.updateMany({
      where: { id: taskId, organizationId }, // Tenant-scoped for safety
      data: { position },
    });
  }

  // ==========================================================================
  // ASSIGNEE MANAGEMENT
  // ==========================================================================

  async addAssignee(taskId: string, userId: string, assignedBy: string): Promise<TaskAssignee> {
    return prisma.taskAssignee.create({
      data: { taskId, userId, assignedBy },
    });
  }

  async removeAssignee(taskId: string, userId: string): Promise<void> {
    await prisma.taskAssignee.deleteMany({ where: { taskId, userId } });
  }

  // ==========================================================================
  // SEQUENCE / POSITION HELPERS
  // ==========================================================================

  // Get the next task number for a project — used to generate "FF-42"
  // INTERVIEW QUESTION: "Is this race-condition safe?"
  // Answer: Not perfectly under very high concurrency. Two requests could both
  // call this, get the same max, and try to create tasks with the same number.
  // Solution: wrap in a DB transaction with SERIALIZABLE isolation, or use
  // a PostgreSQL SEQUENCE. For our educational purposes, aggregate is sufficient.
  async getNextTaskNumber(projectId: string): Promise<number> {
    const result = await prisma.task.aggregate({
      where: { projectId },
      _max: { taskNumber: true },
    });
    return (result._max.taskNumber ?? 0) + 1;
  }

  // Get the position for a new task appended at the end of a board
  async getLastPositionInBoard(boardId: string): Promise<number> {
    const result = await prisma.task.aggregate({
      where: { boardId },
      _max: { position: true },
    });
    return (result._max.position ?? 0) + POSITION_GAP;
  }

  // Fetch the project key (e.g., "FF") for building task identifiers
  async getProjectKey(organizationId: string, projectId: string): Promise<string | null> {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { key: true },
    });
    return project?.key ?? null;
  }

  // Fetch a task with enough info for event publishing (avoids a full SafeTask load)
  async getTaskWithProject(
    organizationId: string,
    taskId: string,
  ): Promise<{ boardId: string; projectId: string; title: string; taskNumber: number; projectKey: string } | null> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: {
        boardId: true,
        projectId: true,
        title: true,
        taskNumber: true,
        project: { select: { key: true } },
      },
    });

    if (!task) return null;
    return {
      boardId: task.boardId,
      projectId: task.projectId,
      title: task.title,
      taskNumber: task.taskNumber,
      projectKey: task.project.key,
    };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  // Transform raw Prisma task (with relations) into the SafeTask response type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSafeTask(task: any): SafeTask {
    const projectKey = task.project?.key ?? 'XX';

    return {
      id: task.id,
      taskNumber: task.taskNumber,
      taskKey: `${projectKey}-${task.taskNumber}`, // "FF-42"
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      position: task.position,
      estimatedHours: task.estimatedHours ? Number(task.estimatedHours) : null,
      actualHours: task.actualHours ? Number(task.actualHours) : null,
      organizationId: task.organizationId,
      projectId: task.projectId,
      boardId: task.boardId,
      reporterId: task.reporterId,
      parentTaskId: task.parentTaskId,
      assignees: (task.assignees ?? []).map((a: any): SafeTaskAssignee => ({
        userId: a.userId,
        assignedAt: a.assignedAt,
        user: {
          id: a.user.id,
          firstName: a.user.firstName,
          lastName: a.user.lastName,
          email: a.user.email,
          avatarUrl: a.user.avatarUrl,
        },
      })),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}
