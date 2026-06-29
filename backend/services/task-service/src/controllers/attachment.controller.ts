// =============================================================================
// ATTACHMENT CONTROLLER — HTTP layer for file attachments
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { AttachmentService } from '../services/attachment.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { ValidationError } from '../utils/errors';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  // GET /tasks/organizations/:orgId/tasks/:taskId/attachments
  list = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const attachments = await this.attachmentService.listAttachments(orgId, taskId);
    sendSuccess(res, { attachments });
  });

  // POST /tasks/organizations/:orgId/tasks/:taskId/attachments
  // Uses multer middleware (configured in task.routes.ts) before this handler
  upload = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId } = req.params;
    const actorId = req.user!.sub;

    // multer sets req.file after processing the multipart/form-data request
    if (!req.file) {
      throw new ValidationError('No file was uploaded. Send a multipart/form-data request with a "file" field.');
    }

    const attachment = await this.attachmentService.uploadAttachment(orgId, taskId, actorId, req.file);
    sendCreated(res, { attachment });
  });

  // DELETE /tasks/organizations/:orgId/tasks/:taskId/attachments/:attachmentId
  delete = asyncHandler(async (req: Request, res: Response) => {
    const { orgId, taskId, attachmentId } = req.params;
    const actorId = req.user!.sub;
    const actorRole = req.orgMember!.role;
    await this.attachmentService.deleteAttachment(orgId, taskId, attachmentId, actorId, actorRole);
    sendNoContent(res);
  });
}
