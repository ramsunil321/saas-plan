// Board routes — mounted at /workspaces/organizations/:orgId/projects/:projectId/boards
import { Router } from 'express';
import { BoardController } from '../controllers/board.controller';
import { BoardService } from '../services/board.service';
import { BoardRepository } from '../repositories/board.repository';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireOrgMember, requirePermission } from '../middlewares/rbac.middleware';
import { createBoardSchema, updateBoardSchema, reorderBoardsSchema } from '../validators/workspace.validator';

const boardRepo = new BoardRepository();
const boardService = new BoardService(boardRepo);
const boardController = new BoardController(boardService);

export const boardRouter = Router({ mergeParams: true });

// GET /workspaces/organizations/:orgId/projects/:projectId/boards
boardRouter.get('/', requireAuth, requireOrgMember, requirePermission('board:view'), boardController.list);

// POST /workspaces/organizations/:orgId/projects/:projectId/boards
boardRouter.post('/', requireAuth, requireOrgMember, requirePermission('board:manage'), validate(createBoardSchema), boardController.create);

// PUT /workspaces/organizations/:orgId/projects/:projectId/boards/reorder
// IMPORTANT: this route must come BEFORE /:boardId to avoid "reorder" matching as a UUID
boardRouter.put('/reorder', requireAuth, requireOrgMember, requirePermission('board:manage'), validate(reorderBoardsSchema), boardController.reorder);

// PUT /workspaces/organizations/:orgId/projects/:projectId/boards/:boardId
boardRouter.put('/:boardId', requireAuth, requireOrgMember, requirePermission('board:manage'), validate(updateBoardSchema), boardController.update);

// DELETE /workspaces/organizations/:orgId/projects/:projectId/boards/:boardId
boardRouter.delete('/:boardId', requireAuth, requireOrgMember, requirePermission('board:manage'), boardController.delete);
