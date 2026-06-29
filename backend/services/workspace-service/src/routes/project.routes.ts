// Project routes — mounted at /workspaces/organizations/:orgId/projects
import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller';
import { ProjectService } from '../services/project.service';
import { ProjectRepository } from '../repositories/project.repository';
import { BoardRepository } from '../repositories/board.repository';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireOrgMember, requirePermission } from '../middlewares/rbac.middleware';
import { createProjectSchema, updateProjectSchema, listProjectsSchema } from '../validators/workspace.validator';

const projectRepo = new ProjectRepository();
const boardRepo = new BoardRepository();
const projectService = new ProjectService(projectRepo, boardRepo);
const projectController = new ProjectController(projectService);

export const projectRouter = Router({ mergeParams: true });

// GET /workspaces/organizations/:orgId/projects
projectRouter.get('/', requireAuth, requireOrgMember, requirePermission('project:view'), validate(listProjectsSchema), projectController.list);

// GET /workspaces/organizations/:orgId/projects/:projectId
projectRouter.get('/:projectId', requireAuth, requireOrgMember, requirePermission('project:view'), projectController.getById);

// POST /workspaces/organizations/:orgId/projects
projectRouter.post('/', requireAuth, requireOrgMember, requirePermission('project:create'), validate(createProjectSchema), projectController.create);

// PUT /workspaces/organizations/:orgId/projects/:projectId
projectRouter.put('/:projectId', requireAuth, requireOrgMember, requirePermission('project:update'), validate(updateProjectSchema), projectController.update);

// POST /workspaces/organizations/:orgId/projects/:projectId/archive
projectRouter.post('/:projectId/archive', requireAuth, requireOrgMember, requirePermission('project:archive'), projectController.archive);

// DELETE /workspaces/organizations/:orgId/projects/:projectId
projectRouter.delete('/:projectId', requireAuth, requireOrgMember, requirePermission('project:delete'), projectController.delete);

// Mount board routes under projects
import { boardRouter } from './board.routes';
projectRouter.use('/:projectId/boards', boardRouter);
