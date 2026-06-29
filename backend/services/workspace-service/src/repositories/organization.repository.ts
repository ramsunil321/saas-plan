// =============================================================================
// ORGANIZATION REPOSITORY — Data Access Layer
// =============================================================================
//
// TENANT ISOLATION PATTERN:
//   Every method that accesses tenant-scoped data REQUIRES organizationId.
//   TypeScript enforces this at compile time — you cannot call these methods
//   without passing the organizationId.
//
//   This is the single most important design decision for multi-tenancy safety.
//   A developer cannot accidentally expose cross-tenant data because:
//   1. The method signature requires organizationId
//   2. Every Prisma query has `where: { organizationId }` as a mandatory condition
//   3. TypeScript errors if you skip it
//
// INTERVIEW QUESTION:
//   "How do you prevent data leakage in a multi-tenant SaaS?"
//   Answer: Row-Level Security (RLS) at the DB level + application-level filtering.
//   We filter every query by organization_id at the application level.
//   For additional safety, PostgreSQL RLS policies can enforce this at the DB level
//   even if application code has a bug. Defense in depth.
// =============================================================================

import { prisma } from '../config/database';
import { User, Organization, OrganizationMember } from '@prisma/client';
import {
  IOrganizationRepository,
  CreateOrganizationData,
  UpdateOrganizationData,
  AddMemberData,
  CreateInvitationData,
  InvitationRecord,
  SafeMember,
} from '../interfaces/workspace.interface';
import { NotFoundError } from '../utils/errors';

export class OrganizationRepository implements IOrganizationRepository {

  async findById(id: string): Promise<Organization | null> {
    return prisma.organization.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return prisma.organization.findUnique({ where: { slug } });
  }

  // Get all organizations a user belongs to (for the "switch org" feature)
  async findUserOrganizations(userId: string) {
    return prisma.organization.findMany({
      where: {
        members: { some: { userId } }, // Filter orgs where user is a member
      },
      include: {
        members: {
          where: { userId }, // Include ONLY the current user's membership record
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    // Use a transaction to:
    // 1. Create the organization
    // 2. Add the creator as the 'owner' member
    // Both must succeed or both fail (atomicity)
    //
    // INTERVIEW QUESTION: "What is a database transaction?"
    // Answer: A group of operations that execute as a single atomic unit.
    // Either ALL operations succeed (commit) or ALL are rolled back (abort).
    // Guarantees ACID: Atomicity, Consistency, Isolation, Durability.
    return prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description,
          createdBy: data.createdBy,
        },
      });

      // Creator automatically becomes the owner
      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: data.createdBy,
          role: 'owner',
        },
      });

      return org;
    });
  }

  async update(id: string, data: UpdateOrganizationData): Promise<Organization> {
    return prisma.organization.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.plan && { plan: data.plan }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    // ON DELETE CASCADE in Prisma schema handles: members, teams, projects, boards, tasks
    await prisma.organization.delete({ where: { id } });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  // ==========================================================================
  // MEMBER MANAGEMENT
  // ==========================================================================

  async findMember(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    return prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  async listMembers(organizationId: string): Promise<SafeMember[]> {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    // Map Prisma result to SafeMember (strip internal fields)
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  }

  async addMember(data: AddMemberData): Promise<OrganizationMember> {
    return prisma.organizationMember.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        role: data.role,
        invitedBy: data.invitedBy,
      },
    });
  }

  async updateMemberRole(organizationId: string, userId: string, role: string): Promise<OrganizationMember> {
    return prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { role },
    });
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    await prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  // ==========================================================================
  // INVITATION MANAGEMENT
  // ==========================================================================

  async createInvitation(data: CreateInvitationData): Promise<{ id: string; token: string; email: string }> {
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: data.organizationId,
        email: data.email,
        role: data.role,
        token: data.token,
        invitedBy: data.invitedBy,
        expiresAt: data.expiresAt,
      },
    });
    return { id: invitation.id, token: invitation.token, email: invitation.email };
  }

  async findInvitationByToken(token: string): Promise<InvitationRecord | null> {
    const inv = await prisma.invitation.findFirst({
      where: {
        token,
        acceptedAt: null,                    // Not yet accepted
        expiresAt: { gt: new Date() },        // Not expired
      },
      include: {
        inviter: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!inv) return null;

    return {
      id: inv.id,
      organizationId: inv.organizationId,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      invitedBy: inv.invitedBy,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      createdAt: inv.createdAt,
      inviter: inv.inviter,
    };
  }

  // Accept an invitation — adds the user to the org in a transaction
  async acceptInvitation(token: string, userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // 1. Find the invitation
      const invitation = await tx.invitation.findFirst({
        where: { token, acceptedAt: null, expiresAt: { gt: new Date() } },
      });

      if (!invitation) throw new NotFoundError('Invitation');

      // 2. Create the org membership
      await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
          invitedBy: invitation.invitedBy,
        },
      });

      // 3. Mark the invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });
  }

  async listPendingInvitations(organizationId: string): Promise<InvitationRecord[]> {
    const invitations = await prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      include: {
        inviter: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      organizationId: inv.organizationId,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      invitedBy: inv.invitedBy,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      createdAt: inv.createdAt,
      inviter: inv.inviter,
    }));
  }
}
