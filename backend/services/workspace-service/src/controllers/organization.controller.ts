// =============================================================================
// ORGANIZATION CONTROLLER — HTTP layer for organization management
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { OrganizationService } from '../services/organization.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  // POST /workspaces/organizations
  create = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.sub;
    const org = await this.orgService.create(userId, req.body);
    sendCreated(res, { organization: org });
  });

  // GET /workspaces/organizations — list all orgs the user belongs to
  listMine = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.sub;
    const orgs = await this.orgService.listUserOrganizations(userId);
    sendSuccess(res, { organizations: orgs });
  });

  // GET /workspaces/organizations/:orgId
  getById = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const userId = req.user!.sub;
    const org = await this.orgService.getById(orgId, userId);
    sendSuccess(res, { organization: org });
  });

  // PUT /workspaces/organizations/:orgId
  update = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const org = await this.orgService.update(orgId, req.body);
    sendSuccess(res, { organization: org });
  });

  // DELETE /workspaces/organizations/:orgId
  delete = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const actorId = req.user!.sub;
    await this.orgService.delete(orgId, actorId);
    sendNoContent(res);
  });

  // GET /workspaces/organizations/:orgId/members
  listMembers = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const members = await this.orgService.listMembers(orgId);
    sendSuccess(res, { members });
  });

  // POST /workspaces/organizations/:orgId/invite
  inviteMember = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const actorId = req.user!.sub;
    const result = await this.orgService.inviteMember(orgId, actorId, req.body);
    sendCreated(res, result);
  });

  // POST /workspaces/invitations/accept
  acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.sub;
    const { token } = req.body;
    const result = await this.orgService.acceptInvitation(token, userId);
    sendSuccess(res, result);
  });

  // DELETE /workspaces/organizations/:orgId/members/:userId
  removeMember = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, userId } = req.params;
    const actorId = req.user!.sub;
    await this.orgService.removeMember(orgId, actorId, userId);
    sendNoContent(res);
  });

  // GET /workspaces/organizations/:orgId/invitations
  listInvitations = asyncHandler(async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const invitations = await this.orgService.listInvitations(orgId);
    sendSuccess(res, { invitations });
  });
}
