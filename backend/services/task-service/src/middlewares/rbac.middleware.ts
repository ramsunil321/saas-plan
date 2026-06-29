// =============================================================================
// RBAC MIDDLEWARE — Role-Based Access Control for task service
// =============================================================================
//
// The permission matrix and middleware chain is IDENTICAL to workspace-service.
// In a production monorepo, this would live in a shared `packages/rbac` package
// imported by both services. Here, each service has its own copy for clarity.
//
// WHY COPY INSTEAD OF SHARE?
//   In a microservices architecture with separate repos (polyrepo), services can't
//   import from each other. Each service is independently deployable.
//   In a monorepo (Turborepo/Nx), shared code lives in packages/ and is imported.
//   This educational project uses a monorepo structure but copies for simplicity.
//
// MIDDLEWARE CHAIN (same as workspace-service):
//   requireAuth → requireOrgMember → requirePermission(perm) → validate(schema) → controller
//
// See workspace-service/src/middlewares/rbac.middleware.ts for full documentation.
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ForbiddenError, UnauthorizedError, NotFoundError } from '../utils/errors';

type Role = 'owner' | 'admin' | 'manager' | 'developer' | 'viewer';
type Permission = keyof typeof PERMISSIONS;

const PERMISSIONS = {
  // Org-level
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

  // Task management
  // Viewers can READ tasks but not write them
  // Developers and above can CREATE and UPDATE tasks
  // Only managers and above can DELETE tasks
  'task:create':    ['owner', 'admin', 'manager', 'developer'] as Role[],
  'task:update':    ['owner', 'admin', 'manager', 'developer'] as Role[],
  'task:delete':    ['owner', 'admin', 'manager'] as Role[],
  'task:assign':    ['owner', 'admin', 'manager', 'developer'] as Role[],

  // Comment — all members except viewers
  'comment:create': ['owner', 'admin', 'manager', 'developer'] as Role[],

  // Analytics
  'analytics:view': ['owner', 'admin', 'manager'] as Role[],
} as const;

export const hasPermission = (role: string, permission: Permission): boolean => {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(role as Role);
};

// =============================================================================
// MIDDLEWARE: requireOrgMember
// =============================================================================
// Extracts :orgId from route params, verifies the authenticated user is
// a member of that organization, and attaches their membership to the request.
//
// This is the TENANT ISOLATION checkpoint — it's impossible to access another
// organization's tasks without first passing this middleware.
//
// RETURNS 404 (not 403) when not a member to prevent org existence enumeration.
// =============================================================================

export const requireOrgMember = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');

    const organizationId = req.params.orgId;
    if (!organizationId) throw new NotFoundError('Organization');

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: req.user.sub,
        },
      },
    });

    if (!membership) {
      // 404 not 403: don't reveal whether the org exists to non-members
      throw new NotFoundError('Organization');
    }

    req.orgMember = membership;
    next();
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// MIDDLEWARE FACTORY: requirePermission
// =============================================================================
// Returns a middleware that checks req.orgMember.role against the permission.
// Must run AFTER requireOrgMember which sets req.orgMember.
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
          `Your role '${role}' does not have permission to perform this action. Required: ${permission}`,
        ),
      );
      return;
    }

    next();
  };
};

export type { Permission };
