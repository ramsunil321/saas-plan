// Board Controller — HTTP layer for Kanban column management.
import { Request, Response, NextFunction } from 'express';
import { BoardService } from '../services/board.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  // GET /workspaces/organizations/:orgId/projects/:projectId/boards
  list = asyncHandler(async (req: Request, res: Response) => {
    const boards = await this.boardService.list(req.params.orgId, req.params.projectId);
    sendSuccess(res, { boards });
  });

  // POST /workspaces/organizations/:orgId/projects/:projectId/boards
  create = asyncHandler(async (req: Request, res: Response) => {
    const board = await this.boardService.create(req.params.orgId, req.params.projectId, req.body);
    sendCreated(res, { board });
  });

  // PUT /workspaces/organizations/:orgId/projects/:projectId/boards/:boardId
  update = asyncHandler(async (req: Request, res: Response) => {
    const board = await this.boardService.update(req.params.orgId, req.params.projectId, req.params.boardId, req.body);
    sendSuccess(res, { board });
  });

  // DELETE /workspaces/organizations/:orgId/projects/:projectId/boards/:boardId
  delete = asyncHandler(async (req: Request, res: Response) => {
    await this.boardService.delete(req.params.orgId, req.params.projectId, req.params.boardId);
    sendNoContent(res);
  });

  // PUT /workspaces/organizations/:orgId/projects/:projectId/boards/reorder
  reorder = asyncHandler(async (req: Request, res: Response) => {
    const boards = await this.boardService.reorder(req.params.orgId, req.params.projectId, req.body.boardIds);
    sendSuccess(res, { boards });
  });
}
