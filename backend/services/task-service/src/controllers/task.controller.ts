// =============================================================================
// TASK CONTROLLER — HTTP layer for task management
// =============================================================================
// Thin layer: extract params → call service → send response.
// All business logic lives in TaskService.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { TaskService } from '../services/task.service';
import { ActivityRepository } from '../repositories/activity.repository';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  // POST /tasks/organizations/:orgId/projects/:projectId/tasks
  create = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, projectId } = req.params;
    const actorId = req.user!.sub;

    const task = await this.taskService.createTask(orgId, projectId, actorId, {
      ...req.body,
      organizationId: orgId,
      projectId,
    });

    sendCreated(res, { task });
  });

  // GET /tasks/organizations/:orgId/projects/:projectId/tasks
  listByProject = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, projectId } = req.params;
    const { page, limit, boardId, status, priority, assigneeId, search, dueDate } = req.query as {
      page?: string; limit?: string; boardId?: string; status?: string;
      priority?: string; assigneeId?: string; search?: string; dueDate?: string;
    };

    const result = await this.taskService.listByProject(
      orgId,
      projectId,
      { boardId, status, priority, assigneeId, search, dueDate },
      { page: Number(page ?? 1), limit: Number(limit ?? 20) },
    );

    sendSuccess(res, { tasks: result.data }, 200, result.meta);
  });

  // GET /tasks/organizations/:orgId/tasks/:taskId
  getById = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const task = await this.taskService.getTask(orgId, taskId);
    sendSuccess(res, { task });
  });

  // PATCH /tasks/organizations/:orgId/tasks/:taskId
  update = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;
    const task = await this.taskService.updateTask(orgId, taskId, actorId, req.body);
    sendSuccess(res, { task });
  });

  // DELETE /tasks/organizations/:orgId/tasks/:taskId
  delete = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;
    await this.taskService.deleteTask(orgId, taskId, actorId);
    sendNoContent(res);
  });

  // POST /tasks/organizations/:orgId/tasks/:taskId/move
  move = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;
    const { targetBoardId, position } = req.body;
    const task = await this.taskService.moveTask(orgId, taskId, actorId, targetBoardId, position);
    sendSuccess(res, { task });
  });

  // POST /tasks/organizations/:orgId/tasks/:taskId/reorder
  reorder = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const { position } = req.body;
    await this.taskService.reorderTask(orgId, taskId, position);
    sendNoContent(res);
  });

  // POST /tasks/organizations/:orgId/tasks/:taskId/assignees
  assign = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;
    const { userIds } = req.body;
    const task = await this.taskService.assignTask(orgId, taskId, actorId, userIds);
    sendSuccess(res, { task });
  });

  // DELETE /tasks/organizations/:orgId/tasks/:taskId/assignees/:userId
  unassign = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId, userId } = req.params;
    const actorId = req.user!.sub;
    await this.taskService.unassignTask(orgId, taskId, actorId, userId);
    sendNoContent(res);
  });

  // GET /tasks/organizations/:orgId/tasks/:taskId/activity
  getActivity = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const { page, limit } = req.query as { page?: string; limit?: string };

    // ActivityRepository queried directly (no separate service needed for reads)
    const activityRepo = new ActivityRepository();
    const result = await activityRepo.listForTask(
      orgId,
      taskId,
      { page: Number(page ?? 1), limit: Number(limit ?? 20) },
    );

    sendSuccess(res, { activity: result.data }, 200, result.meta);
  });
}
