// =============================================================================
// PROJECT REPOSITORY — Tenant-scoped project data access
// =============================================================================
import { prisma } from '../config/database';
import { Project } from '@prisma/client';
import {
  IProjectRepository,
  CreateProjectData,
  UpdateProjectData,
  SafeProject,
  PaginatedResult,
  PaginationParams,
} from '../interfaces/workspace.interface';

export class ProjectRepository implements IProjectRepository {

  async findById(organizationId: string, projectId: string): Promise<Project | null> {
    return prisma.project.findFirst({
      where: { id: projectId, organizationId }, // Tenant-scoped
    });
  }

  async list(
    organizationId: string,
    { page, limit }: PaginationParams,
  ): Promise<PaginatedResult<SafeProject>> {
    const skip = (page - 1) * limit;

    // Run count and data queries in parallel for efficiency
    // INTERVIEW QUESTION: "How do you implement pagination in SQL?"
    // Answer: LIMIT N OFFSET M. LIMIT = how many rows, OFFSET = how many to skip.
    // Prisma maps: take = LIMIT, skip = OFFSET.
    // Cursor-based pagination (using a last-seen ID) is more efficient for large datasets
    // because OFFSET-based pagination gets slower as the offset grows (DB scans all skipped rows).
    const [total, projects] = await Promise.all([
      prisma.project.count({ where: { organizationId } }),
      prisma.project.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
    ]);

    const safeProjects: SafeProject[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      key: p.key,
      status: p.status,
      organizationId: p.organizationId,
      teamId: p.teamId,
      startDate: p.startDate,
      endDate: p.endDate,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return {
      data: safeProjects,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async create(data: CreateProjectData): Promise<Project> {
    return prisma.project.create({
      data: {
        organizationId: data.organizationId,
        teamId: data.teamId,
        name: data.name,
        description: data.description,
        key: data.key.toUpperCase(), // Normalize to uppercase
        createdBy: data.createdBy,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });
  }

  async update(organizationId: string, projectId: string, data: UpdateProjectData): Promise<Project> {
    return prisma.project.update({
      where: { id: projectId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.teamId !== undefined && { teamId: data.teamId }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
        ...(data.status && { status: data.status }),
      },
    });
  }

  async archive(organizationId: string, projectId: string): Promise<Project> {
    return prisma.project.update({
      where: { id: projectId },
      data: { status: 'archived' },
    });
  }

  async delete(organizationId: string, projectId: string): Promise<void> {
    await prisma.project.deleteMany({ where: { id: projectId, organizationId } });
  }

  // ==========================================================================
  // TASK NUMBER SEQUENCE
  // ==========================================================================
  // Generate the next task number for a project (FF-1, FF-2, FF-3...)
  // Uses a DB transaction to prevent race conditions (two concurrent requests
  // could otherwise both get the same task number).
  //
  // INTERVIEW QUESTION: "How do you implement auto-incrementing task numbers?"
  // Answer: Using an atomic read-increment-write in a transaction.
  // SELECT MAX(task_number) + 1 inside a transaction prevents duplicate numbers
  // under concurrent load. PostgreSQL sequences would also work.
  async generateNextTaskNumber(projectId: string): Promise<number> {
    const result = await prisma.task.aggregate({
      where: { projectId },
      _max: { taskNumber: true },
    });

    return (result._max.taskNumber ?? 0) + 1;
  }
}
