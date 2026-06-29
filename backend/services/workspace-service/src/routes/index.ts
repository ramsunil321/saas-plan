// =============================================================================
// WORKSPACE ROUTES — Master router combining all sub-routers
// =============================================================================
//
// All workspace routes are prefixed with /workspaces in app.ts.
// This file assembles all the sub-routers into one mounted router.
//
// ROUTE TABLE SUMMARY:
//   Organizations: /workspaces/organizations/...
//   Invitations:   /workspaces/invitations/...
//   Teams:         /workspaces/organizations/:orgId/teams/...
//   Projects:      /workspaces/organizations/:orgId/projects/...
//   Boards:        /workspaces/organizations/:orgId/projects/:projectId/boards/...
// =============================================================================

import { Router } from 'express';
import { organizationRouter } from './organization.routes';
import { teamRouter } from './team.routes';
import { projectRouter } from './project.routes';
import { boardRouter } from './board.routes';

export const workspaceRouter = Router();

// Organizations (and nested resources under them)
workspaceRouter.use('/organizations', organizationRouter);

// Invitations (not nested under org — the token IS the lookup key)
// Handled inside organizationRouter as /organizations/invitations/accept
