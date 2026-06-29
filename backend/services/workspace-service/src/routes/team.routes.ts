// Team routes — mounted at /workspaces/organizations/:orgId/teams
// Note: orgId param is inherited from the parent router (organization.routes.ts)
// Express mergeParams: true is needed to access parent route params.

import { Router } from 'express';
import { TeamController } from '../controllers/team.controller';
import { TeamService } from '../services/team.service';
import { TeamRepository } from '../repositories/team.repository';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireOrgMember, requirePermission } from '../middlewares/rbac.middleware';
import { createTeamSchema, updateTeamSchema, addTeamMemberSchema } from '../validators/workspace.validator';

const teamRepo = new TeamRepository();
const teamService = new TeamService(teamRepo);
const teamController = new TeamController(teamService);

// mergeParams: true — allows access to :orgId from parent router
export const teamRouter = Router({ mergeParams: true });

// GET /workspaces/organizations/:orgId/teams
teamRouter.get('/', requireAuth, requireOrgMember, requirePermission('team:view'), teamController.list);

// GET /workspaces/organizations/:orgId/teams/:teamId
teamRouter.get('/:teamId', requireAuth, requireOrgMember, requirePermission('team:view'), teamController.getById);

// POST /workspaces/organizations/:orgId/teams
teamRouter.post('/', requireAuth, requireOrgMember, requirePermission('team:create'), validate(createTeamSchema), teamController.create);

// PUT /workspaces/organizations/:orgId/teams/:teamId
teamRouter.put('/:teamId', requireAuth, requireOrgMember, requirePermission('team:update'), validate(updateTeamSchema), teamController.update);

// DELETE /workspaces/organizations/:orgId/teams/:teamId
teamRouter.delete('/:teamId', requireAuth, requireOrgMember, requirePermission('team:delete'), teamController.delete);

// GET /workspaces/organizations/:orgId/teams/:teamId/members
teamRouter.get('/:teamId/members', requireAuth, requireOrgMember, requirePermission('team:view'), teamController.listMembers);

// POST /workspaces/organizations/:orgId/teams/:teamId/members
teamRouter.post('/:teamId/members', requireAuth, requireOrgMember, requirePermission('team:addMember'), validate(addTeamMemberSchema), teamController.addMember);

// DELETE /workspaces/organizations/:orgId/teams/:teamId/members/:userId
teamRouter.delete('/:teamId/members/:userId', requireAuth, requireOrgMember, requirePermission('team:addMember'), teamController.removeMember);
