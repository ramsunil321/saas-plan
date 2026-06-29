// =============================================================================
// ATTACHMENT SERVICE — File upload and management for tasks
// =============================================================================
//
// FILE UPLOAD FLOW:
//   1. Client sends multipart/form-data POST request
//   2. Multer middleware intercepts, saves file to disk, sets req.file
//   3. This service creates a DB record with the file metadata
//   4. Response includes the storageUrl where the file can be accessed
//
// PRODUCTION SWAP (Local → S3):
//   Current: multer diskStorage → file saved to ./uploads/
//   Production: multer-s3 → file streamed directly to S3
//
//   The service layer doesn't change — only the multer configuration changes.
//   storageKey  = S3 object key (e.g., "org-1/task-1/attachment-uuid.pdf")
//   storageUrl  = S3 presigned URL (time-limited, expires after 1 hour)
//
// MIME TYPE VALIDATION:
//   Multer's fileFilter rejects disallowed MIME types at the middleware level.
//   This service trusts that req.file.mimetype is valid.
//
// INTERVIEW QUESTION: "What is a presigned URL?"
//   Answer: A time-limited URL signed by the server (or S3) that grants temporary
//   access to a private resource without exposing credentials. The URL includes
//   a signature and expiration time. After expiry, the URL stops working.
//   This allows clients to directly download from S3 without going through
//   your backend, reducing bandwidth costs.
// =============================================================================

import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { CacheKeys } from '../config/redis';
import { invalidate } from '../utils/cache';
import { logger } from '../utils/logger';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import {
  IAttachmentRepository,
  ITaskRepository,
  IActivityRepository,
  SafeAttachment,
} from '../interfaces/task.interface';

export class AttachmentService {
  constructor(
    private readonly attachmentRepo: IAttachmentRepository,
    private readonly taskRepo: ITaskRepository,
    private readonly activityRepo: IActivityRepository,
  ) {}

  async listAttachments(organizationId: string, taskId: string): Promise<SafeAttachment[]> {
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    return this.attachmentRepo.list(organizationId, taskId);
  }

  async uploadAttachment(
    organizationId: string,
    taskId: string,
    actorId: string,
    file: Express.Multer.File,
  ): Promise<SafeAttachment> {
    // Verify the task exists and belongs to this organization
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    // The file is already saved to disk by multer (see task.routes.ts for multer config)
    // storageKey = relative file path on disk
    // storageUrl = public URL to access the file
    const storageKey = file.path;
    const storageUrl = `${env.FRONTEND_URL.replace('3000', '3003')}/uploads/${path.basename(file.path)}`;

    const attachment = await this.attachmentRepo.create({
      taskId,
      organizationId,
      uploadedBy: actorId,
      fileName: file.originalname,
      fileSize: BigInt(file.size),
      mimeType: file.mimetype,
      storageKey,
      storageUrl,
    });

    await invalidate(CacheKeys.taskAttachments(taskId));

    this.activityRepo.create({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'attachment.added',
      actorId,
      metadata: {
        fileName: file.originalname,
        fileSize: file.size,
        taskKey: task.taskKey,
      },
    }).catch((err) => logger.error('[AttachmentService] Activity log failed', { err }));

    logger.info('[AttachmentService] File uploaded', {
      taskId,
      fileName: file.originalname,
      fileSize: file.size,
    });

    return attachment;
  }

  async deleteAttachment(
    organizationId: string,
    taskId: string,
    attachmentId: string,
    actorId: string,
    actorRole: string,
  ): Promise<void> {
    const attachment = await this.attachmentRepo.findById(organizationId, attachmentId);
    if (!attachment) throw new NotFoundError('Attachment');

    const isUploader = attachment.uploadedBy === actorId;
    const isManager = ['owner', 'admin', 'manager'].includes(actorRole);

    // Only the uploader or a manager+ can delete attachments
    if (!isUploader && !isManager) {
      throw new ForbiddenError('You do not have permission to delete this attachment');
    }

    // Delete the physical file from disk
    // In production (S3): use s3.deleteObject({ Bucket, Key: attachment.storageKey })
    try {
      await fs.unlink(attachment.storageKey);
    } catch (err) {
      // If the file is already gone, don't fail the DB delete
      logger.warn('[AttachmentService] Could not delete file from disk', {
        storageKey: attachment.storageKey,
        err,
      });
    }

    await this.attachmentRepo.delete(organizationId, attachmentId);

    await invalidate(CacheKeys.taskAttachments(taskId));

    this.activityRepo.create({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'attachment.deleted',
      actorId,
      metadata: { attachmentId, fileName: attachment.fileName },
    }).catch(() => {});
  }
}
