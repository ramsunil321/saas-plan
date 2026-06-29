// =============================================================================
// ORGANIZATION ROUTES — Full RBAC middleware chain
// =============================================================================
//
// MIDDLEWARE CHAIN EXPLANATION:
//   requireAuth         → Verify JWT → sets req.user
//   requireOrgMember    → Load org membership → sets req.orgMember (with role)
//   requirePermission() → Check role has the required permission → 403 if not
//   validate(schema)    → Zod validation → 400 if invalid
//   controller.method   → Business logic → response
//
// This chain is the key architectural pattern of Phase 3.
// Every protected mutation route has all three middleware layers.
// READ operations (GET) still require org membership but not special permissions.
// =============================================================================

import { Router } from 'express';
import { OrganizationController } from '../controllers/organization.controller';
import { OrganizationService } from '../services/organization.service';
import { OrganizationRepository } from '../repositories/organization.repository';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireOrgMember, requirePermission } from '../middlewares/rbac.middleware';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  inviteMemberSchema,
  removeMemberSchema,
  acceptInvitationSchema,
} from '../validators/workspace.validator';

// Dependency injection (manual, no IoC container)
const orgRepo = new OrganizationRepository();
const orgService = new OrganizationService(orgRepo);
const orgController = new OrganizationController(orgService);

export const organizationRouter = Router();

// ============================================================
// PUBLIC / LIGHTLY PROTECTED ROUTES
// ============================================================

// Create a new organization — any authenticated user
// POST /workspaces/organizations
organizationRouter.post(
  '/',
  requireAuth,
  validate(createOrganizationSchema),
  orgController.create,
);

// Get all orgs the current user belongs to
// GET /workspaces/organizations
organizationRouter.get('/', requireAuth, orgController.listMine);

// Accept an org invitation — requires auth (must be logged in to join)
// POST /workspaces/organizations/invitations/accept
organizationRouter.post(
  '/invitations/accept',
  requireAuth,
  validate(acceptInvitationSchema),
  orgController.acceptInvitation,
);

// ============================================================
// ORG-SPECIFIC ROUTES (require org membership)
// ============================================================

// Get organization details — any member
// GET /workspaces/organizations/:orgId
organizationRouter.get(
  '/:orgId',
  requireAuth,
  requireOrgMember,
  orgController.getById,
);

// Update organization — admin+ only
// PUT /workspaces/organizations/:orgId
organizationRouter.put(
  '/:orgId',
  requireAuth,
  requireOrgMember,
  requirePermission('org:update'),
  validate(updateOrganizationSchema),
  orgController.update,
);

// Delete organization — owner only
// DELETE /workspaces/organizations/:orgId
organizationRouter.delete(
  '/:orgId',
  requireAuth,
  requireOrgMember,
  requirePermission('org:delete'),
  orgController.delete,
);

// ============================================================
// MEMBER MANAGEMENT
// ============================================================

// List members — any member
// GET /workspaces/organizations/:orgId/members
organizationRouter.get(
  '/:orgId/members',
  requireAuth,
  requireOrgMember,
  requirePermission('member:view'),
  orgController.listMembers,
);

// Invite member — admin+ only
// POST /workspaces/organizations/:orgId/invite
organizationRouter.post(
  '/:orgId/invite',
  requireAuth,
  requireOrgMember,
  requirePermission('member:invite'),
  validate(inviteMemberSchema),
  orgController.inviteMember,
);

// Remove member — admin+ only
// DELETE /workspaces/organizations/:orgId/members/:userId
organizationRouter.delete(
  '/:orgId/members/:userId',
  requireAuth,
  requireOrgMember,
  requirePermission('member:remove'),
  validate(removeMemberSchema),
  orgController.removeMember,
);

// List pending invitations — admin+ only
// GET /workspaces/organizations/:orgId/invitations
organizationRouter.get(
  '/:orgId/invitations',
  requireAuth,
  requireOrgMember,
  requirePermission('member:invite'),
  orgController.listInvitations,
);

// Import nested routers AFTER org routes to avoid param conflicts
import { teamRouter } from './team.routes';
import { projectRouter } from './project.routes';

// Mount team routes under /organizations/:orgId/teams
organizationRouter.use('/:orgId/teams', teamRouter);

// Mount project routes under /organizations/:orgId/projects
organizationRouter.use('/:orgId/projects', projectRouter);
