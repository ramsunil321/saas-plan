// =============================================================================
// COMMENT SERVICE — Business logic for task comments
// =============================================================================
//
// BUSINESS RULES:
//   1. Any org member with 'comment:create' permission can comment
//   2. Only the comment AUTHOR can EDIT their own comment
//   3. Comment DELETION: author OR manager+ can delete
//   4. Replies can only be added to TOP-LEVEL comments (not to replies)
//      This enforces the two-level threading model
//
// WHY ENFORCE AUTHORSHIP IN THE SERVICE LAYER?
//   The RBAC middleware checks the user's ROLE in the organization.
//   But role-checking alone isn't enough for comment editing:
//   ANY developer could have 'comment:create' permission, but only the
//   AUTHOR of a specific comment should be able to EDIT it.
//   This is resource-level authorization (ABAC), not just role-level (RBAC).
//   RBAC says "developers can comment". ABAC says "only the author can edit".
//   Both are needed together.
// =============================================================================

import { CacheKeys } from '../config/redis';
import { invalidate } from '../utils/cache';
import { logger } from '../utils/logger';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { ICommentRepository, IActivityRepository, ITaskRepository, SafeComment, CreateCommentData } from '../interfaces/task.interface';
import { publishCommentAdded } from '../events/publishers/task.publisher';

export class CommentService {
  constructor(
    private readonly commentRepo: ICommentRepository,
    private readonly taskRepo: ITaskRepository,
    private readonly activityRepo: IActivityRepository,
  ) {}

  async listComments(organizationId: string, taskId: string): Promise<SafeComment[]> {
    // Verify task exists (tenant isolation check)
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    return this.commentRepo.list(organizationId, taskId);
  }

  async addComment(
    organizationId: string,
    taskId: string,
    actorId: string,
    content: string,
    parentId?: string,
  ): Promise<SafeComment> {
    // Verify task exists
    const task = await this.taskRepo.findById(organizationId, taskId);
    if (!task) throw new NotFoundError('Task');

    // If this is a reply, verify the parent comment exists and is a top-level comment
    // (prevent replies to replies — enforces two-level threading)
    if (parentId) {
      const parentComment = await this.commentRepo.findById(organizationId, parentId);
      if (!parentComment) throw new NotFoundError('Parent comment');
      if (parentComment.parentId !== null) {
        throw new ForbiddenError('Cannot reply to a reply. Please reply to the top-level comment.');
      }
    }

    const data: CreateCommentData = {
      taskId,
      organizationId,
      authorId: actorId,
      content,
      parentId,
    };

    const comment = await this.commentRepo.create(data);

    // Invalidate the task's comment cache
    await invalidate(CacheKeys.taskComments(taskId));

    // Log activity (fire-and-forget)
    this.activityRepo.create({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'comment.added',
      actorId,
      metadata: { commentId: comment.id, taskKey: task.taskKey, isReply: !!parentId },
    }).catch((err) => logger.error('[CommentService] Activity log failed', { err }));

    // Publish event (fire-and-forget)
    publishCommentAdded(organizationId, actorId, {
      taskId,
      taskKey: task.taskKey,
      commentId: comment.id,
      taskTitle: task.title,
    }).catch(() => {});

    return comment;
  }

  async updateComment(
    organizationId: string,
    taskId: string,
    commentId: string,
    actorId: string,
    content: string,
  ): Promise<SafeComment> {
    const comment = await this.commentRepo.findById(organizationId, commentId);
    if (!comment) throw new NotFoundError('Comment');

    // RESOURCE-LEVEL AUTH: only the comment author can edit their comment
    if (comment.authorId !== actorId) {
      throw new ForbiddenError('You can only edit your own comments');
    }

    await this.commentRepo.update(organizationId, commentId, content);

    await invalidate(CacheKeys.taskComments(taskId));

    // Re-fetch to return updated data with author info
    const updatedList = await this.commentRepo.list(organizationId, taskId);
    const updatedComment = this.findCommentInList(updatedList, commentId);
    return updatedComment ?? { id: commentId, taskId, content, isEdited: true, parentId: null, createdAt: new Date(), updatedAt: new Date(), author: { id: actorId, firstName: '', lastName: '', avatarUrl: null } };
  }

  async deleteComment(
    organizationId: string,
    taskId: string,
    commentId: string,
    actorId: string,
    actorRole: string,
  ): Promise<void> {
    const comment = await this.commentRepo.findById(organizationId, commentId);
    if (!comment) throw new NotFoundError('Comment');

    const isAuthor = comment.authorId === actorId;
    const isManager = ['owner', 'admin', 'manager'].includes(actorRole);

    // Either the author OR a manager+ can delete a comment
    if (!isAuthor && !isManager) {
      throw new ForbiddenError('You do not have permission to delete this comment');
    }

    await this.commentRepo.delete(organizationId, commentId);

    await invalidate(CacheKeys.taskComments(taskId));

    this.activityRepo.create({
      organizationId,
      entityType: 'task',
      entityId: taskId,
      action: 'comment.deleted',
      actorId,
      metadata: { commentId },
    }).catch(() => {});
  }

  // Helper to find a comment in a nested list (top-level + replies)
  private findCommentInList(comments: SafeComment[], commentId: string): SafeComment | null {
    for (const c of comments) {
      if (c.id === commentId) return c;
      if (c.replies) {
        const found = this.findCommentInList(c.replies, commentId);
        if (found) return found;
      }
    }
    return null;
  }
}
