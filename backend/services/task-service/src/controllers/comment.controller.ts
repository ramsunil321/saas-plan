// =============================================================================
// COMMENT CONTROLLER — HTTP layer for task comments
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { CommentService } from '../services/comment.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  // GET /tasks/organizations/:orgId/tasks/:taskId/comments
  list = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const comments = await this.commentService.listComments(orgId, taskId);
    sendSuccess(res, { comments });
  });

  // POST /tasks/organizations/:orgId/tasks/:taskId/comments
  create = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;
    const { content, parentId } = req.body;
    const comment = await this.commentService.addComment(orgId, taskId, actorId, content, parentId);
    sendCreated(res, { comment });
  });

  // PATCH /tasks/organizations/:orgId/tasks/:taskId/comments/:commentId
  update = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId, commentId } = req.params;
    const actorId = req.user!.sub;
    const { content } = req.body;
    const comment = await this.commentService.updateComment(orgId, taskId, commentId, actorId, content);
    sendSuccess(res, { comment });
  });

  // DELETE /tasks/organizations/:orgId/tasks/:taskId/comments/:commentId
  delete = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId, commentId } = req.params;
    const actorId = req.user!.sub;
    const actorRole = req.orgMember!.role;
    await this.commentService.deleteComment(orgId, taskId, commentId, actorId, actorRole);
    sendNoContent(res);
  });
}
