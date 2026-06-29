// Team Service — business logic for team management.
import { ITeamRepository, SafeTeam, SafeMember, CreateTeamData } from '../interfaces/workspace.interface';
import { NotFoundError, ConflictError } from '../utils/errors';
import { CacheKeys } from '../config/redis';
import { getOrFetch, invalidate } from '../utils/cache';
import { publishTeamCreated } from '../events/publishers/workspace.publisher';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';

export class TeamService {
  constructor(private readonly teamRepo: ITeamRepository) {}

  async list(organizationId: string): Promise<SafeTeam[]> {
    return getOrFetch(
      CacheKeys.teamList(organizationId),
      () => this.teamRepo.list(organizationId),
    );
  }

  async getById(organizationId: string, teamId: string): Promise<SafeTeam> {
    const team = await this.teamRepo.findById(organizationId, teamId);
    if (!team) throw new NotFoundError('Team');

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      organizationId: team.organizationId,
      createdAt: team.createdAt,
    };
  }

  async create(organizationId: string, creatorId: string, data: { name: string; description?: string }): Promise<SafeTeam> {
    const team = await this.teamRepo.create({ organizationId, createdBy: creatorId, ...data });

    // Add creator as team lead automatically
    await this.teamRepo.addMember(team.id, creatorId, 'lead');

    // Invalidate team list cache
    await invalidate(CacheKeys.teamList(organizationId));

    publishTeamCreated(organizationId, creatorId, { teamId: team.id, teamName: team.name }).catch(() => {});

    logger.info('[TeamService] Team created', { teamId: team.id, organizationId });

    return { id: team.id, name: team.name, description: team.description, organizationId: team.organizationId, createdAt: team.createdAt };
  }

  async update(organizationId: string, teamId: string, data: { name?: string; description?: string }): Promise<SafeTeam> {
    const existing = await this.teamRepo.findById(organizationId, teamId);
    if (!existing) throw new NotFoundError('Team');

    const updated = await this.teamRepo.update(organizationId, teamId, data);

    await invalidate(CacheKeys.teamList(organizationId));

    return { id: updated.id, name: updated.name, description: updated.description, organizationId: updated.organizationId, createdAt: updated.createdAt };
  }

  async delete(organizationId: string, teamId: string): Promise<void> {
    const existing = await this.teamRepo.findById(organizationId, teamId);
    if (!existing) throw new NotFoundError('Team');

    await this.teamRepo.delete(organizationId, teamId);
    await invalidate(CacheKeys.teamList(organizationId));
  }

  async addMember(organizationId: string, teamId: string, userId: string, role: string): Promise<void> {
    const team = await this.teamRepo.findById(organizationId, teamId);
    if (!team) throw new NotFoundError('Team');

    // Verify user is an org member first
    const orgMembership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!orgMembership) throw new NotFoundError('User must be an organization member before joining a team');

    // Check for duplicate team membership
    const members = await this.teamRepo.listMembers(teamId);
    if (members.find((m) => m.userId === userId)) {
      throw new ConflictError('User is already a member of this team');
    }

    await this.teamRepo.addMember(teamId, userId, role);
  }

  async removeMember(organizationId: string, teamId: string, userId: string): Promise<void> {
    const team = await this.teamRepo.findById(organizationId, teamId);
    if (!team) throw new NotFoundError('Team');

    await this.teamRepo.removeMember(teamId, userId);
  }

  async listMembers(organizationId: string, teamId: string): Promise<SafeMember[]> {
    const team = await this.teamRepo.findById(organizationId, teamId);
    if (!team) throw new NotFoundError('Team');

    return this.teamRepo.listMembers(teamId);
  }
}
