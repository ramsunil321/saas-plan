// Board Service — Kanban column management.
import { IBoardRepository, SafeBoard } from '../interfaces/workspace.interface';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { CacheKeys } from '../config/redis';
import { getOrFetch, invalidate } from '../utils/cache';
import { Board } from '@prisma/client';

export class BoardService {
  constructor(private readonly boardRepo: IBoardRepository) {}

  private toSafe(b: Board): SafeBoard {
    return { id: b.id, name: b.name, position: b.position, color: b.color, isDefault: b.isDefault, projectId: b.projectId };
  }

  async list(organizationId: string, projectId: string): Promise<SafeBoard[]> {
    return getOrFetch(
      CacheKeys.boardList(organizationId, projectId),
      async () => {
        const boards = await this.boardRepo.list(organizationId, projectId);
        return boards.map(this.toSafe);
      },
    );
  }

  async create(organizationId: string, projectId: string, data: { name: string; position: number; color?: string }): Promise<SafeBoard> {
    const board = await this.boardRepo.create({ ...data, projectId, organizationId });
    await invalidate(CacheKeys.boardList(organizationId, projectId));
    return this.toSafe(board);
  }

  async update(organizationId: string, projectId: string, boardId: string, data: { name?: string; color?: string }): Promise<SafeBoard> {
    const existing = await this.boardRepo.findById(organizationId, boardId);
    if (!existing) throw new NotFoundError('Board');

    const updated = await this.boardRepo.update(organizationId, boardId, data);
    await invalidate(CacheKeys.boardList(organizationId, projectId));
    return this.toSafe(updated);
  }

  async delete(organizationId: string, projectId: string, boardId: string): Promise<void> {
    const existing = await this.boardRepo.findById(organizationId, boardId);
    if (!existing) throw new NotFoundError('Board');

    // Default boards cannot be deleted (they define the core workflow)
    if (existing.isDefault) {
      throw new ForbiddenError('Default boards cannot be deleted. You can rename or recolor them.');
    }

    await this.boardRepo.delete(organizationId, boardId);
    await invalidate(CacheKeys.boardList(organizationId, projectId));
  }

  async reorder(organizationId: string, projectId: string, boardIds: string[]): Promise<SafeBoard[]> {
    await this.boardRepo.reorder(organizationId, projectId, boardIds);
    await invalidate(CacheKeys.boardList(organizationId, projectId));

    // Return updated list
    const boards = await this.boardRepo.list(organizationId, projectId);
    return boards.map(this.toSafe);
  }
}
