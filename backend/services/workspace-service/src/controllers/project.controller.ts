// Project Controller — HTTP layer for project management.
import { Request, Response, NextFunction } from 'express';
import { ProjectService } from '../services/project.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  // GET /workspaces/organizations/:orgId/projects?page=1&limit=20
  list = asyncHandler(async (req: Request, res: Response) => {
    const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };
    const result = await this.projectService.list(req.params.orgId, {
      page: Number(page),
      limit: Number(limit),
    });
    sendSuccess(res, { projects: result.data }, 200, result.meta);
  });

  // GET /workspaces/organizations/:orgId/projects/:projectId
  getById = asyncHandler(async (req: Request, res: Response) => {
    const project = await this.projectService.getById(req.params.orgId, req.params.projectId);
    sendSuccess(res, { project });
  });

  // POST /workspaces/organizations/:orgId/projects
  create = asyncHandler(async (req: Request, res: Response) => {
    const project = await this.projectService.create(req.params.orgId, req.user!.sub, req.body);
    sendCreated(res, { project });
  });

  // PUT /workspaces/organizations/:orgId/projects/:projectId
  update = asyncHandler(async (req: Request, res: Response) => {
    const project = await this.projectService.update(req.params.orgId, req.params.projectId, req.user!.sub, req.body);
    sendSuccess(res, { project });
  });

  // POST /workspaces/organizations/:orgId/projects/:projectId/archive
  archive = asyncHandler(async (req: Request, res: Response) => {
    const project = await this.projectService.archive(req.params.orgId, req.params.projectId, req.user!.sub);
    sendSuccess(res, { project });
  });

  // DELETE /workspaces/organizations/:orgId/projects/:projectId
  delete = asyncHandler(async (req: Request, res: Response) => {
    await this.projectService.delete(req.params.orgId, req.params.projectId);
    sendNoContent(res);
  });
}
