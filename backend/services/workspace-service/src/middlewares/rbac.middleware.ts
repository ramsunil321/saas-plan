// =============================================================================
// RBAC MIDDLEWARE — Role-Based Access Control
// =============================================================================
//
// WHY THIS FILE EXISTS:
//   Without RBAC, ANY authenticated user could DELETE any organization,
//   REMOVE any member, or ARCHIVE any project — regardless of their role.
//   RBAC ensures users can only perform actions their role permits.
//
// ARCHITECTURE — THREE MIDDLEWARE LAYERS:
//
//   1. requireAuth      (auth.middleware.ts)
//      → Verifies the JWT, sets req.user
//
//   2. requireOrgMember (this file)
//      → Loads the user's OrganizationMember record from DB
//      → Verifies the user is actually IN the organization (cross-org protection)
//      → Sets req.orgMember (contains role: 'owner'|'admin'|'manager'|...)
//
//   3. requirePermission('project:create') (this file)
//      → Checks if req.orgMember.role has the required permission
//      → 403 Forbidden if not
//
// PERMISSION MATRIX (from Phase 1 architecture):
//   Each permission maps to a list of roles that CAN perform it.
//   Adding a new role is O(1): add it to the relevant permission arrays.
//
// INTERVIEW QUESTION:
//   "What is the difference between RBAC and ABAC?"
//   Answer: RBAC (Role-Based): permissions are assigned to ROLES, users get roles.
//   Simple, efficient, scales to thousands of users.
//   ABAC (Attribute-Based): permissions based on ATTRIBUTES of user, resource,
//   and environment. Example: "can edit if author AND during business hours."
//   More flexible but more complex. RBAC is right for most SaaS apps.
//   FlowForge uses RBAC with a permission matrix.
//
// INTERVIEW QUESTION:
//   "How does RBAC prevent privilege escalation?"
//   Answer: A Developer cannot grant someone the Admin role (only owner/admin can
//   invite with a specific role). A Manager cannot remove an Owner. The role
//   check in requireOrgMember also prevents a user from accessing a DIFFERENT
//   organization's resources by pretending to be a member.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ForbiddenError, UnauthorizedError, NotFoundError } from '../utils/errors';

// =============================================================================
// PERMISSION MATRIX
// =============================================================================
// Key: permission string used in code
// Value: roles that are ALLOWED to perform this action
// =============================================================================

type Role = 'owner' | 'admin' | 'manager' | 'developer' | 'viewer';
type Permission = keyof typeof PERMISSIONS;

const PERMISSIONS = {
  // Organization-level
  'org:update':     ['owner', 'admin'] as Role[],
  'org:delete':     ['owner'] as Role[],

  // Member management
  'member:invite':  ['owner', 'admin'] as Role[],
  'member:remove':  ['owner', 'admin'] as Role[],
  'member:view':    ['owner', 'admin', 'manager', 'developer', 'viewer'] as Role[],

  // Team management
  'team:create':    ['owner', 'admin'] as Role[],
  'team:update':    ['owner', 'admin', 'manager'] as Role[],
  'team:delete':    ['owner', 'admin'] as Role[],
  'team:view':      ['owner', 'admin', 'manager', 'developer', 'viewer'] as Role[],
  'team:addMember': ['owner', 'admin', 'manager'] as Role[],

  // Project management
  'project:create': ['owner', 'admin', 'manager'] as Role[],
  'project:update': ['owner', 'admin', 'manager'] as Role[],
  'project:delete': ['owner', 'admin'] as Role[],
  'project:archive':['owner', 'admin', 'manager'] as Role[],
  'project:view':   ['owner', 'admin', 'manager', 'developer', 'viewer'] as Role[],

  // Board management
  'board:manage':   ['owner', 'admin', 'manager'] as Role[],
  'board:view':     ['owner', 'admin', 'manager', 'developer', 'viewer'] as Role[],

  // Task management (used by task-service but defined centrally here)
  'task:create':    ['owner', 'admin', 'manager', 'developer'] as Role[],
  'task:update':    ['owner', 'admin', 'manager', 'developer'] as Role[],
  'task:delete':    ['owner', 'admin', 'manager'] as Role[],
  'task:assign':    ['owner', 'admin', 'manager', 'developer'] as Role[],

  // Comment
  'comment:create': ['owner', 'admin', 'manager', 'developer'] as Role[],

  // Analytics
  'analytics:view': ['owner', 'admin', 'manager'] as Role[],
} as const;

// =============================================================================
// HELPER — Check if a role has a permission
// =============================================================================

export const hasPermission = (role: string, permission: Permission): boolean => {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(role as Role);
};

// =============================================================================
// MIDDLEWARE 1: requireOrgMember
// =============================================================================
// Extracts organizationId from URL params, verifies the authenticated user
// is a member of that organization, and loads their membership record.
//
// This is the TENANT ISOLATION check — prevents cross-org data access.
//
// Usage: router.get('/orgs/:orgId/...', requireAuth, requireOrgMember, ...)
// =============================================================================

export const requireOrgMember = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Extract orgId from URL params — set by Express route matching
    const organizationId = req.params.orgId;
    if (!organizationId) {
      throw new NotFoundError('Organization');
    }

    // Look up the user's membership in THIS organization
    // This single DB query:
    //   1. Verifies the org exists
    //   2. Verifies the user is a member (tenant isolation)
    //   3. Loads their current role (fresh from DB — not from stale JWT)
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: req.user.sub,
        },
      },
    });

    if (!membership) {
      // Return 404 instead of 403 to not reveal whether the org exists
      // (an outsider shouldn't know if "org-id-123" is a valid org)
      throw new NotFoundError('Organization');
    }

    // Attach the full membership record to the request
    req.orgMember = membership;

    next();
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// MIDDLEWARE 2: requirePermission
// =============================================================================
// Factory function: requirePermission('project:create') returns a middleware
// that checks if the current user's org role has that permission.
//
// Must be used AFTER requireOrgMember (which sets req.orgMember).
//
// INTERVIEW QUESTION: "What is a middleware factory?"
// Answer: A function that takes configuration and RETURNS a middleware function.
// requirePermission('org:delete') is called at route DEFINITION time.
// The returned (req, res, next) function runs at REQUEST time.
// =============================================================================

export const requirePermission = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.orgMember) {
      next(new UnauthorizedError('Organization membership required'));
      return;
    }

    const { role } = req.orgMember;

    if (!hasPermission(role, permission)) {
      next(
        new ForbiddenError(
          `Your role '${role}' does not have permission to perform this action. Required permission: ${permission}`,
        ),
      );
      return;
    }

    next();
  };
};

// Export permission type for use in route files
export type { Permission };
