// =============================================================================
// ATTACHMENT REPOSITORY — File attachments on tasks
// =============================================================================
//
// STORAGE ARCHITECTURE:
//   Current implementation: local filesystem (multer diskStorage)
//   Production upgrade path: AWS S3 (swap storageKey + storageUrl generation)
//
//   storageKey = the S3 object key (or local file path)
//   storageUrl = the publicly accessible URL (S3 presigned URL, or local /uploads path)
//
//   To swap to S3:
//   1. npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner multer-s3
//   2. Change multer diskStorage to multer-s3 storage
//   3. storageKey = s3Object.key
//   4. storageUrl = await getSignedUrl(s3Client, new GetObjectCommand({ ... }), { expiresIn: 3600 })
//   5. fileSize = BigInt(s3Object.size)
//
// WHY BigInt FOR FILE SIZE?
//   JavaScript's Number can't represent integers > 2^53 - 1 (9 petabytes in bytes
//   would be fine, but BigInt is the PostgreSQL BIGINT mapping in Prisma).
//   We serialize to string for JSON because JSON doesn't support BigInt.
// =============================================================================

import { prisma } from '../config/database';
import { Attachment } from '@prisma/client';
import {
  IAttachmentRepository,
  SafeAttachment,
  CreateAttachmentData,
} from '../interfaces/task.interface';

export class AttachmentRepository implements IAttachmentRepository {

  async list(organizationId: string, taskId: string): Promise<SafeAttachment[]> {
    const attachments = await prisma.attachment.findMany({
      where: { taskId, organizationId },
      include: {
        uploader: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return attachments.map((a) => this.toSafeAttachment(a));
  }

  async findById(organizationId: string, attachmentId: string): Promise<Attachment | null> {
    return prisma.attachment.findFirst({
      where: { id: attachmentId, organizationId },
    });
  }

  async create(data: CreateAttachmentData): Promise<SafeAttachment> {
    const attachment = await prisma.attachment.create({
      data: {
        taskId: data.taskId,
        organizationId: data.organizationId,
        uploadedBy: data.uploadedBy,
        fileName: data.fileName,
        fileSize: data.fileSize, // BigInt
        mimeType: data.mimeType,
        storageKey: data.storageKey,
        storageUrl: data.storageUrl,
      },
      include: {
        uploader: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return this.toSafeAttachment(attachment);
  }

  async delete(organizationId: string, attachmentId: string): Promise<void> {
    await prisma.attachment.deleteMany({
      where: { id: attachmentId, organizationId },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSafeAttachment(attachment: any): SafeAttachment {
    return {
      id: attachment.id,
      taskId: attachment.taskId,
      fileName: attachment.fileName,
      // Serialize BigInt to string for JSON compatibility
      // JSON.stringify cannot serialize BigInt natively
      fileSize: attachment.fileSize.toString(),
      mimeType: attachment.mimeType,
      storageUrl: attachment.storageUrl,
      uploadedAt: attachment.createdAt,
      uploader: {
        id: attachment.uploader.id,
        firstName: attachment.uploader.firstName,
        lastName: attachment.uploader.lastName,
      },
    };
  }
}
