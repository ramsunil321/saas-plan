// =============================================================================
// WORKSPACE VALIDATORS — Zod schemas for all workspace endpoints
// =============================================================================
import { z } from 'zod';

// =============================================================================
// SHARED SCHEMAS
// =============================================================================

// UUID parameter validator — reused across all route params
const uuidParam = z.string().uuid('Invalid ID format');

const paginationSchema = z.object({
  page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(1000)).default('20'),
});

// Valid org roles for invitations
const orgRole = z.enum(['admin', 'manager', 'developer', 'viewer'], {
  errorMap: () => ({ message: 'Role must be one of: admin, manager, developer, viewer' }),
});

// =============================================================================
// ORGANIZATION SCHEMAS
// =============================================================================

// Slug rules: lowercase letters, numbers, hyphens only (URL-safe)
const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(50, 'Slug must not exceed 50 characters')
  .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
  .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with a hyphen');

export const createOrganizationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    slug: slugSchema,
    description: z.string().trim().max(500).optional(),
  }),
});

export const updateOrganizationSchema = z.object({
  params: z.object({ orgId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    logoUrl: z.string().url('Logo URL must be valid').optional(),
  }),
});

export const inviteMemberSchema = z.object({
  params: z.object({ orgId: uuidParam }),
  body: z.object({
    email: z.string().email('Invalid email address').toLowerCase().trim(),
    role: orgRole,
  }),
});

export const removeMemberSchema = z.object({
  params: z.object({ orgId: uuidParam, userId: uuidParam }),
});

export const acceptInvitationSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Invitation token is required'),
  }),
});

// =============================================================================
// TEAM SCHEMAS
// =============================================================================

export const createTeamSchema = z.object({
  params: z.object({ orgId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(100),
    description: z.string().trim().max(500).optional(),
  }),
});

export const updateTeamSchema = z.object({
  params: z.object({ orgId: uuidParam, teamId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
  }),
});

export const addTeamMemberSchema = z.object({
  params: z.object({ orgId: uuidParam, teamId: uuidParam }),
  body: z.object({
    userId: uuidParam,
    role: z.enum(['lead', 'member']).default('member'),
  }),
});

// =============================================================================
// PROJECT SCHEMAS
// =============================================================================

// Project key: 2-10 uppercase letters (like Jira's PROJ, FF, BE)
const projectKeySchema = z
  .string()
  .min(2, 'Project key must be at least 2 characters')
  .max(10, 'Project key must not exceed 10 characters')
  .regex(/^[A-Z0-9]+$/, 'Project key can only contain uppercase letters and numbers')
  .transform((s) => s.toUpperCase());

export const createProjectSchema = z.object({
  params: z.object({ orgId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(200),
    description: z.string().trim().max(1000).optional(),
    key: projectKeySchema,
    teamId: uuidParam.optional(),
    startDate: z.string().datetime().optional().transform((d) => d ? new Date(d) : undefined),
    endDate: z.string().datetime().optional().transform((d) => d ? new Date(d) : undefined),
  }),
});

export const updateProjectSchema = z.object({
  params: z.object({ orgId: uuidParam, projectId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    teamId: uuidParam.nullable().optional(),
    startDate: z.string().datetime().nullable().optional().transform((d) => d ? new Date(d) : null),
    endDate: z.string().datetime().nullable().optional().transform((d) => d ? new Date(d) : null),
  }),
});

export const listProjectsSchema = z.object({
  params: z.object({ orgId: uuidParam }),
  query: paginationSchema,
});

// =============================================================================
// BOARD SCHEMAS
// =============================================================================

export const createBoardSchema = z.object({
  params: z.object({ orgId: uuidParam, projectId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(1, 'Board name is required').max(100),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color (e.g. #3B82F6)').optional(),
    position: z.number().int().min(0),
  }),
});

export const updateBoardSchema = z.object({
  params: z.object({ orgId: uuidParam, projectId: uuidParam, boardId: uuidParam }),
  body: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),
});

export const reorderBoardsSchema = z.object({
  params: z.object({ orgId: uuidParam, projectId: uuidParam }),
  body: z.object({
    // Array of board IDs in the desired new order
    boardIds: z.array(uuidParam).min(1, 'At least one board ID is required'),
  }),
});

// =============================================================================
// INFERRED TYPES
// =============================================================================

export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>['body'];
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>['body'];
export type InviteMemberBody = z.infer<typeof inviteMemberSchema>['body'];
export type CreateTeamBody = z.infer<typeof createTeamSchema>['body'];
export type UpdateTeamBody = z.infer<typeof updateTeamSchema>['body'];
export type CreateProjectBody = z.infer<typeof createProjectSchema>['body'];
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>['body'];
export type CreateBoardBody = z.infer<typeof createBoardSchema>['body'];
export type ReorderBoardsBody = z.infer<typeof reorderBoardsSchema>['body'];
