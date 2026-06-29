// =============================================================================
// ORGANIZATION SERVICE — Business Logic Layer
// =============================================================================
//
// RESPONSIBILITIES:
//   1. Orchestrate repository calls for organization CRUD
//   2. Enforce business rules (owner can't remove themselves, slug uniqueness)
//   3. Manage invitations (generate token, send email, accept)
//   4. Publish events to RabbitMQ after successful mutations
//   5. Invalidate Redis cache on data changes
//
// CACHE STRATEGY (Write-Through + Cache-Aside):
//   On READ: check cache first (getOrFetch), fall back to DB, store in cache
//   On WRITE: update DB first, then invalidate related cache keys
//   WHY invalidate instead of update? Simpler logic. The next read will
//   re-populate from the fresh DB data.
// =============================================================================

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { IOrganizationRepository, SafeOrganization, OrganizationWithRole, SafeMember } from '../interfaces/workspace.interface';
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { CacheKeys } from '../config/redis';
import { getOrFetch, invalidate, invalidateMany } from '../utils/cache';
import { publishMemberInvited, publishMemberJoined, publishMemberRemoved } from '../events/publishers/workspace.publisher';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { Organization } from '@prisma/client';

export class OrganizationService {
  constructor(private readonly orgRepo: IOrganizationRepository) {}

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private toSafe(org: Organization): SafeOrganization {
    return {
      id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl,
      description: org.description, plan: org.plan, createdAt: org.createdAt,
    };
  }

  // Send invitation email via Nodemailer
  private async sendInvitationEmail(
    email: string,
    inviterName: string,
    orgName: string,
    token: string,
  ): Promise<void> {
    try {
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });

      const inviteUrl = `${env.FRONTEND_URL}/invitations/accept?token=${token}`;

      await transport.sendMail({
        from: `"FlowForge" <${env.EMAIL_FROM}>`,
        to: email,
        subject: `${inviterName} invited you to join ${orgName} on FlowForge`,
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
            <h2>You've been invited to FlowForge</h2>
            <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong>.</p>
            <a href="${inviteUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Accept Invitation</a>
            <p>This invitation expires in ${env.INVITATION_EXPIRES_HOURS} hours.</p>
          </div>
        `,
      });
    } catch (error) {
      logger.error('[OrgService] Failed to send invitation email', { email, error });
    }
  }

  // ==========================================================================
  // CREATE ORGANIZATION
  // ==========================================================================
  async create(
    userId: string,
    data: { name: string; slug: string; description?: string },
  ): Promise<SafeOrganization> {
    // Check slug uniqueness
    const existing = await this.orgRepo.findBySlug(data.slug);
    if (existing) throw new ConflictError(`Organization slug '${data.slug}' is already taken`);

    const org = await this.orgRepo.create({ ...data, createdBy: userId });

    logger.info('[OrgService] Organization created', { orgId: org.id, userId });

    return this.toSafe(org);
  }

  // ==========================================================================
  // GET ORGANIZATION
  // ==========================================================================
  async getById(orgId: string, userId: string): Promise<OrganizationWithRole> {
    const cacheKey = CacheKeys.organization(orgId);

    const org = await getOrFetch(cacheKey, async () => {
      const found = await this.orgRepo.findById(orgId);
      if (!found) throw new NotFoundError('Organization');
      return found;
    });

    const membership = await this.orgRepo.findMember(orgId, userId);
    const memberCount = (await this.orgRepo.listMembers(orgId)).length;

    return {
      ...this.toSafe(org),
      role: membership?.role ?? 'viewer',
      memberCount,
    };
  }

  // ==========================================================================
  // LIST USER'S ORGANIZATIONS
  // ==========================================================================
  async listUserOrganizations(userId: string): Promise<OrganizationWithRole[]> {
    const cacheKey = CacheKeys.userOrgs(userId);

    return getOrFetch(cacheKey, async () => {
      const orgs = await this.orgRepo.findUserOrganizations(userId);
      return orgs.map((org) => ({
        ...this.toSafe(org),
        role: org.members[0]?.role ?? 'viewer',
        memberCount: 0, // Loaded separately if needed
      }));
    });
  }

  // ==========================================================================
  // UPDATE ORGANIZATION
  // ==========================================================================
  async update(
    orgId: string,
    data: { name?: string; description?: string; logoUrl?: string },
  ): Promise<SafeOrganization> {
    const org = await this.orgRepo.findById(orgId);
    if (!org) throw new NotFoundError('Organization');

    const updated = await this.orgRepo.update(orgId, data);

    // Invalidate all org-related cache
    await invalidateMany([CacheKeys.organization(orgId), CacheKeys.memberList(orgId)]);

    return this.toSafe(updated);
  }

  // ==========================================================================
  // DELETE ORGANIZATION
  // ==========================================================================
  async delete(orgId: string, actorId: string): Promise<void> {
    const membership = await this.orgRepo.findMember(orgId, actorId);
    if (!membership || membership.role !== 'owner') {
      throw new ForbiddenError('Only the organization owner can delete the organization');
    }

    await this.orgRepo.delete(orgId);

    // Invalidate all org-related cache patterns
    await invalidate(CacheKeys.organization(orgId));

    logger.info('[OrgService] Organization deleted', { orgId, actorId });
  }

  // ==========================================================================
  // LIST MEMBERS
  // ==========================================================================
  async listMembers(orgId: string): Promise<SafeMember[]> {
    return getOrFetch(
      CacheKeys.memberList(orgId),
      () => this.orgRepo.listMembers(orgId),
    );
  }

  // ==========================================================================
  // INVITE MEMBER
  // ==========================================================================
  async inviteMember(
    orgId: string,
    actorId: string,
    data: { email: string; role: string },
  ): Promise<{ message: string }> {
    // 1. Find user by email
    const user = await this.orgRepo.findUserByEmail(data.email);
    if (!user) {
      throw new NotFoundError(`User with email '${data.email}' not found. They must register first.`);
    }

    // 2. Check if the user is already a member
    const existingMember = await this.orgRepo.findMember(orgId, user.id);
    if (existingMember) {
      throw new ConflictError('This user is already a member of this organization');
    }

    // 3. Add member directly
    await this.orgRepo.addMember({
      organizationId: orgId,
      userId: user.id,
      role: data.role,
      invitedBy: actorId,
    });

    // 4. Invalidate the member list cache
    await invalidate(CacheKeys.memberList(orgId));
    await invalidate(CacheKeys.userOrgs(user.id));

    // 5. Publish event for notification service
    publishMemberJoined(orgId, user.id, {
      userId: user.id,
      role: data.role,
    }).catch(() => {});

    return { message: `Successfully added ${data.email} to the organization.` };
  }

  // ==========================================================================
  // ACCEPT INVITATION
  // ==========================================================================
  async acceptInvitation(token: string, userId: string): Promise<{ organizationId: string }> {
    const invitation = await this.orgRepo.findInvitationByToken(token);
    if (!invitation) {
      throw new ValidationError('Invalid or expired invitation link');
    }

    await this.orgRepo.acceptInvitation(token, userId);

    // Invalidate the member list cache
    await invalidate(CacheKeys.memberList(invitation.organizationId));
    await invalidate(CacheKeys.userOrgs(userId));

    // Publish event
    publishMemberJoined(invitation.organizationId, userId, {
      userId,
      role: invitation.role,
    }).catch(() => {});

    return { organizationId: invitation.organizationId };
  }

  // ==========================================================================
  // REMOVE MEMBER
  // ==========================================================================
  async removeMember(orgId: string, actorId: string, targetUserId: string): Promise<void> {
    // Cannot remove yourself (use delete org or transfer ownership instead)
    if (actorId === targetUserId) {
      throw new ForbiddenError('You cannot remove yourself from the organization. Transfer ownership first.');
    }

    // Cannot remove the owner
    const targetMembership = await this.orgRepo.findMember(orgId, targetUserId);
    if (!targetMembership) throw new NotFoundError('Member');
    if (targetMembership.role === 'owner') {
      throw new ForbiddenError('The organization owner cannot be removed');
    }

    await this.orgRepo.removeMember(orgId, targetUserId);

    await invalidateMany([
      CacheKeys.memberList(orgId),
      CacheKeys.userOrgs(targetUserId),
    ]);

    publishMemberRemoved(orgId, actorId, { removedUserId: targetUserId }).catch(() => {});
  }

  // ==========================================================================
  // LIST PENDING INVITATIONS
  // ==========================================================================
  async listInvitations(orgId: string) {
    return this.orgRepo.listPendingInvitations(orgId);
  }
}
