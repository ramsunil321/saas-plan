// =============================================================================
// COMMENT REPOSITORY — Threaded comments on tasks
// =============================================================================
//
// THREADING MODEL:
//   Comments have an optional `parentId` (self-referential foreign key).
//   Top-level comments have parentId = null.
//   Replies have parentId = the comment they're replying to.
//   This creates a two-level tree (GitHub-style), not infinite nesting.
//
// WHY TWO LEVELS, NOT INFINITE?
//   Infinite nesting requires recursive queries (CTEs with RECURSIVE in SQL),
//   which are complex and hard to paginate. Two levels covers 95% of use cases
//   and is trivial to query (one extra filter in the WHERE clause).
//   If infinite nesting is needed, use a closure table or materialized path.
//
// INTERVIEW QUESTION: "What is a self-referential foreign key?"
//   Answer: A foreign key that points to the SAME TABLE's primary key.
//   Here, comments.parent_id → comments.id allows a tree structure.
//   Use cases: org charts, file systems, threaded comments, category hierarchies.
// =============================================================================

import { prisma } from '../config/database';
import { Comment } from '@prisma/client';
import {
  ICommentRepository,
  SafeComment,
  CreateCommentData,
} from '../interfaces/task.interface';

// Include shape for comment queries with author data
const commentInclude = {
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
    },
  },
} as const;

export class CommentRepository implements ICommentRepository {

  // List all top-level comments for a task, with their replies nested
  async list(organizationId: string, taskId: string): Promise<SafeComment[]> {
    // Fetch only TOP-LEVEL comments (parentId = null)
    const topLevelComments = await prisma.comment.findMany({
      where: {
        taskId,
        organizationId,
        parentId: null, // Only top-level comments
      },
      include: {
        ...commentInclude,
        // Fetch replies (one level deep)
        replies: {
          include: commentInclude,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' }, // Chronological order
    });

    return topLevelComments.map((c) => this.toSafeComment(c));
  }

  async findById(organizationId: string, commentId: string): Promise<Comment | null> {
    return prisma.comment.findFirst({
      where: { id: commentId, organizationId },
    });
  }

  async create(data: CreateCommentData): Promise<SafeComment> {
    const comment = await prisma.comment.create({
      data: {
        taskId: data.taskId,
        organizationId: data.organizationId,
        authorId: data.authorId,
        content: data.content,
        parentId: data.parentId,
      },
      include: {
        ...commentInclude,
        replies: { include: commentInclude },
      },
    });

    return this.toSafeComment(comment);
  }

  async update(organizationId: string, commentId: string, content: string): Promise<Comment> {
    return prisma.comment.update({
      where: { id: commentId },
      data: {
        content,
        isEdited: true, // Track that this comment was modified
      },
    });
  }

  async delete(organizationId: string, commentId: string): Promise<void> {
    // deleteMany for tenant safety (includes organizationId in WHERE)
    await prisma.comment.deleteMany({ where: { id: commentId, organizationId } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSafeComment(comment: any): SafeComment {
    return {
      id: comment.id,
      taskId: comment.taskId,
      content: comment.content,
      isEdited: comment.isEdited,
      parentId: comment.parentId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: {
        id: comment.author.id,
        firstName: comment.author.firstName,
        lastName: comment.author.lastName,
        avatarUrl: comment.author.avatarUrl,
      },
      replies: comment.replies?.map((r: any) => this.toSafeComment(r)),
    };
  }
}
