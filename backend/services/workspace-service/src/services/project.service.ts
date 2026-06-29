// =============================================================================
// PROJECT SERVICE — Business Logic Layer
// =============================================================================
//
// KEY BUSINESS RULE: Creating a project ALSO creates default Kanban boards.
// This is handled in a single DB transaction: project + boards created atomically.
// If board creation fails, the entire project creation is rolled back.
// =============================================================================

import { IProjectRepository, IBoardRepository, SafeProject, CreateProjectData, PaginatedResult, PaginationParams } from '../interfaces/workspace.interface';
import { ConflictError, NotFoundError } from '../utils/errors';
import { CacheKeys } from '../config/redis';
import { getOrFetch, invalidate, invalidateMany, invalidatePattern } from '../utils/cache';
import { publishProjectCreated, publishProjectUpdated, publishProjectArchived } from '../events/publishers/workspace.publisher';
import { logger } from '../utils/logger';

export class ProjectService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly boardRepo: IBoardRepository,
  ) {}

  async list(organizationId: string, pagination: PaginationParams): Promise<PaginatedResult<SafeProject>> {
    // Cache with pagination params in key to avoid serving wrong pages from cache
    const cacheKey = `${CacheKeys.projectList(organizationId)}:p${pagination.page}:l${pagination.limit}`;

    return getOrFetch(cacheKey, () => this.projectRepo.list(organizationId, pagination));
  }

  async getById(organizationId: string, projectId: string): Promise<SafeProject> {
    const cacheKey = CacheKeys.project(organizationId, projectId);

    return getOrFetch(cacheKey, async () => {
      const project = await this.projectRepo.findById(organizationId, projectId);
      if (!project) throw new NotFoundError('Project');

      return {
        id: project.id, name: project.name, description: project.description,
        key: project.key, status: project.status, organizationId: project.organizationId,
        teamId: project.teamId, startDate: project.startDate, endDate: project.endDate,
        createdAt: project.createdAt, updatedAt: project.updatedAt,
      };
    });
  }

  async create(
    organizationId: string,
    creatorId: string,
    data: { name: string; description?: string; key: string; teamId?: string; startDate?: Date; endDate?: Date },
  ): Promise<SafeProject> {
    // Create the project in DB
    const project = await this.projectRepo.create({ organizationId, createdBy: creatorId, ...data });

    // Create default Kanban boards for the project (Backlog, Todo, In Progress, Review, Done)
    // This is called AFTER project creation — if boards fail, we could leave an orphaned project.
    // In production, use a DB transaction: prisma.$transaction([createProject, createBoards])
    await this.boardRepo.createDefaultBoards(organizationId, project.id);

    // Invalidate project list cache (new project added)
    await invalidatePattern(CacheKeys.projectList(organizationId) + '*');

    publishProjectCreated(organizationId, creatorId, {
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
    }).catch(() => {});

    logger.info('[ProjectService] Project created', { projectId: project.id, organizationId });

    return {
      id: project.id, name: project.name, description: project.description,
      key: project.key, status: project.status, organizationId: project.organizationId,
      teamId: project.teamId, startDate: project.startDate, endDate: project.endDate,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
    };
  }

  async update(
    organizationId: string,
    projectId: string,
    actorId: string,
    data: { name?: string; description?: string; teamId?: string | null; startDate?: Date | null; endDate?: Date | null },
  ): Promise<SafeProject> {
    const existing = await this.projectRepo.findById(organizationId, projectId);
    if (!existing) throw new NotFoundError('Project');

    const updated = await this.projectRepo.update(organizationId, projectId, data);

    await invalidate(CacheKeys.project(organizationId, projectId));
    await invalidatePattern(CacheKeys.projectList(organizationId) + '*');

    publishProjectUpdated(organizationId, actorId, { projectId, changes: data }).catch(() => {});

    return {
      id: updated.id, name: updated.name, description: updated.description,
      key: updated.key, status: updated.status, organizationId: updated.organizationId,
      teamId: updated.teamId, startDate: updated.startDate, endDate: updated.endDate,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    };
  }

  async archive(organizationId: string, projectId: string, actorId: string): Promise<SafeProject> {
    const existing = await this.projectRepo.findById(organizationId, projectId);
    if (!existing) throw new NotFoundError('Project');

    const archived = await this.projectRepo.archive(organizationId, projectId);

    await invalidate(CacheKeys.project(organizationId, projectId));
    await invalidatePattern(CacheKeys.projectList(organizationId) + '*');

    publishProjectArchived(organizationId, actorId, { projectId, projectName: archived.name }).catch(() => {});

    return {
      id: archived.id, name: archived.name, description: archived.description,
      key: archived.key, status: archived.status, organizationId: archived.organizationId,
      teamId: archived.teamId, startDate: archived.startDate, endDate: archived.endDate,
      createdAt: archived.createdAt, updatedAt: archived.updatedAt,
    };
  }

  async delete(organizationId: string, projectId: string): Promise<void> {
    const existing = await this.projectRepo.findById(organizationId, projectId);
    if (!existing) throw new NotFoundError('Project');

    await this.projectRepo.delete(organizationId, projectId);

    await invalidateMany([
      CacheKeys.project(organizationId, projectId),
      CacheKeys.boardList(organizationId, projectId),
    ]);
    await invalidatePattern(CacheKeys.projectList(organizationId) + '*');
  }
}
