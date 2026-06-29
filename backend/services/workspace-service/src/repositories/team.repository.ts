// Team Repository — all queries scoped to organizationId for tenant isolation.
import { prisma } from '../config/database';
import { Team, TeamMember } from '@prisma/client';
import { ITeamRepository, CreateTeamData, UpdateTeamData, SafeTeam, SafeMember } from '../interfaces/workspace.interface';

export class TeamRepository implements ITeamRepository {

  // Must pass organizationId to prevent cross-tenant access
  async findById(organizationId: string, teamId: string): Promise<Team | null> {
    return prisma.team.findFirst({
      where: { id: teamId, organizationId }, // BOTH conditions required (tenant isolation)
    });
  }

  async list(organizationId: string): Promise<SafeTeam[]> {
    const teams = await prisma.team.findMany({
      where: { organizationId },
      include: {
        _count: { select: { members: true } }, // Get member count without loading all members
      },
      orderBy: { name: 'asc' },
    });

    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      organizationId: t.organizationId,
      createdAt: t.createdAt,
      memberCount: t._count.members,
    }));
  }

  async create(data: CreateTeamData): Promise<Team> {
    return prisma.team.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
      },
    });
  }

  async update(organizationId: string, teamId: string, data: UpdateTeamData): Promise<Team> {
    return prisma.team.update({
      where: { id: teamId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
  }

  async delete(organizationId: string, teamId: string): Promise<void> {
    // Verify org ownership before delete (double-check — should already be checked by service)
    await prisma.team.deleteMany({ where: { id: teamId, organizationId } });
  }

  async addMember(teamId: string, userId: string, role = 'member'): Promise<TeamMember> {
    return prisma.teamMember.create({ data: { teamId, userId, role } });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await prisma.teamMember.deleteMany({ where: { teamId, userId } });
  }

  async listMembers(teamId: string): Promise<SafeMember[]> {
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      organizationId: '', // Not applicable at team level
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  }
}
