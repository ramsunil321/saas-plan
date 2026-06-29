// Team Controller — HTTP layer for team management.
import { Request, Response, NextFunction } from 'express';
import { TeamService } from '../services/team.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // GET /workspaces/organizations/:orgId/teams
  list = asyncHandler(async (req: Request, res: Response) => {
    const teams = await this.teamService.list(req.params.orgId);
    sendSuccess(res, { teams });
  });

  // GET /workspaces/organizations/:orgId/teams/:teamId
  getById = asyncHandler(async (req: Request, res: Response) => {
    const team = await this.teamService.getById(req.params.orgId, req.params.teamId);
    sendSuccess(res, { team });
  });

  // POST /workspaces/organizations/:orgId/teams
  create = asyncHandler(async (req: Request, res: Response) => {
    const team = await this.teamService.create(req.params.orgId, req.user!.sub, req.body);
    sendCreated(res, { team });
  });

  // PUT /workspaces/organizations/:orgId/teams/:teamId
  update = asyncHandler(async (req: Request, res: Response) => {
    const team = await this.teamService.update(req.params.orgId, req.params.teamId, req.body);
    sendSuccess(res, { team });
  });

  // DELETE /workspaces/organizations/:orgId/teams/:teamId
  delete = asyncHandler(async (req: Request, res: Response) => {
    await this.teamService.delete(req.params.orgId, req.params.teamId);
    sendNoContent(res);
  });

  // GET /workspaces/organizations/:orgId/teams/:teamId/members
  listMembers = asyncHandler(async (req: Request, res: Response) => {
    const members = await this.teamService.listMembers(req.params.orgId, req.params.teamId);
    sendSuccess(res, { members });
  });

  // POST /workspaces/organizations/:orgId/teams/:teamId/members
  addMember = asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = req.body;
    await this.teamService.addMember(req.params.orgId, req.params.teamId, userId, role);
    sendCreated(res, { message: 'Member added to team' });
  });

  // DELETE /workspaces/organizations/:orgId/teams/:teamId/members/:userId
  removeMember = asyncHandler(async (req: Request, res: Response) => {
    await this.teamService.removeMember(req.params.orgId, req.params.teamId, req.params.userId);
    sendNoContent(res);
  });
}
