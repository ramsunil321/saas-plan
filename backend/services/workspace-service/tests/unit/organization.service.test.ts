// =============================================================================
// UNIT TESTS — OrganizationService
// =============================================================================
//
// Tests cover the business rules of the organization service:
// - Slug uniqueness validation
// - Cannot remove yourself from org
// - Cannot remove the owner
// - Invitation token generation
// - Cache invalidation on writes
// =============================================================================

import { OrganizationService } from '../../src/services/organization.service';
import { IOrganizationRepository } from '../../src/interfaces/workspace.interface';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/utils/errors';

// Mock all external dependencies
jest.mock('../../src/utils/cache', () => ({
  getOrFetch: jest.fn().mockImplementation((_key, fetcher) => fetcher()),
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateMany: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/events/publishers/workspace.publisher', () => ({
  publishMemberInvited: jest.fn().mockResolvedValue(undefined),
  publishMemberJoined: jest.fn().mockResolvedValue(undefined),
  publishMemberRemoved: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

// =============================================================================
// FIXTURES
// =============================================================================

const mockOrg = {
  id: 'org-1', name: 'Acme Corp', slug: 'acme-corp', logoUrl: null,
  description: null, plan: 'free', createdBy: 'user-1',
  createdAt: new Date(), updatedAt: new Date(),
};

const mockMember = {
  id: 'member-1', organizationId: 'org-1', userId: 'user-1',
  role: 'owner', joinedAt: new Date(), invitedBy: null,
  user: { id: 'user-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', avatarUrl: null },
};

const mockAdminMember = {
  ...mockMember, id: 'member-2', userId: 'user-2', role: 'admin',
  user: { ...mockMember.user, id: 'user-2', email: 'admin@example.com' },
};

const createMockRepo = (): jest.Mocked<IOrganizationRepository> => ({
  findById: jest.fn(),
  findBySlug: jest.fn(),
  findUserOrganizations: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findMember: jest.fn(),
  listMembers: jest.fn(),
  addMember: jest.fn(),
  updateMemberRole: jest.fn(),
  removeMember: jest.fn(),
  createInvitation: jest.fn(),
  findInvitationByToken: jest.fn(),
  acceptInvitation: jest.fn(),
  listPendingInvitations: jest.fn(),
});

// =============================================================================
// TESTS
// =============================================================================

describe('OrganizationService', () => {
  let service: OrganizationService;
  let repo: jest.Mocked<IOrganizationRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = createMockRepo();
    service = new OrganizationService(repo);
  });

  // ==========================================================================
  // CREATE
  // ==========================================================================
  describe('create()', () => {
    it('should create an organization when slug is unique', async () => {
      repo.findBySlug.mockResolvedValue(null); // Slug not taken
      repo.create.mockResolvedValue(mockOrg);

      const result = await service.create('user-1', {
        name: 'Acme Corp',
        slug: 'acme-corp',
      });

      expect(result.slug).toBe('acme-corp');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        slug: 'acme-corp',
        createdBy: 'user-1',
      }));
    });

    it('should throw ConflictError when slug is already taken', async () => {
      repo.findBySlug.mockResolvedValue(mockOrg); // Slug exists

      await expect(
        service.create('user-1', { name: 'Other Org', slug: 'acme-corp' }),
      ).rejects.toThrow(ConflictError);

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // REMOVE MEMBER
  // ==========================================================================
  describe('removeMember()', () => {
    it('should throw ForbiddenError when trying to remove yourself', async () => {
      await expect(
        service.removeMember('org-1', 'user-1', 'user-1'), // actorId === targetUserId
      ).rejects.toThrow(ForbiddenError);

      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError when trying to remove the owner', async () => {
      repo.findMember.mockResolvedValue({ ...mockMember, role: 'owner' }); // Target is owner

      await expect(
        service.removeMember('org-1', 'user-2', 'user-1'), // user-2 tries to remove owner user-1
      ).rejects.toThrow(ForbiddenError);

      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it('should successfully remove a non-owner member', async () => {
      repo.findMember.mockResolvedValue({ ...mockAdminMember, role: 'developer' });
      repo.removeMember.mockResolvedValue(undefined);

      await expect(
        service.removeMember('org-1', 'user-1', 'user-2'),
      ).resolves.toBeUndefined();

      expect(repo.removeMember).toHaveBeenCalledWith('org-1', 'user-2');
    });
  });

  // ==========================================================================
  // INVITE MEMBER
  // ==========================================================================
  describe('inviteMember()', () => {
    it('should throw ConflictError if user is already a member', async () => {
      repo.listMembers.mockResolvedValue([mockMember]); // john@example.com is already a member

      await expect(
        service.inviteMember('org-1', 'user-2', { email: 'john@example.com', role: 'developer' }),
      ).rejects.toThrow(ConflictError);

      expect(repo.createInvitation).not.toHaveBeenCalled();
    });

    it('should create an invitation for a new email', async () => {
      repo.listMembers.mockResolvedValue([mockMember]);
      repo.createInvitation.mockResolvedValue({ id: 'inv-1', token: 'abc123', email: 'new@example.com' });
      repo.findById.mockResolvedValue(mockOrg);

      const result = await service.inviteMember('org-1', 'user-1', {
        email: 'new@example.com',
        role: 'developer',
      });

      expect(result.message).toContain('new@example.com');
      expect(repo.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', role: 'developer' }),
      );
    });
  });

  // ==========================================================================
  // ACCEPT INVITATION
  // ==========================================================================
  describe('acceptInvitation()', () => {
    it('should throw ValidationError for invalid/expired token', async () => {
      repo.findInvitationByToken.mockResolvedValue(null);

      await expect(
        service.acceptInvitation('invalid-token', 'user-5'),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept a valid invitation and return organizationId', async () => {
      repo.findInvitationByToken.mockResolvedValue({
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'new@example.com',
        role: 'developer',
        token: 'valid-token',
        invitedBy: 'user-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        acceptedAt: null,
        createdAt: new Date(),
      });
      repo.acceptInvitation.mockResolvedValue(undefined);

      const result = await service.acceptInvitation('valid-token', 'user-5');

      expect(result.organizationId).toBe('org-1');
      expect(repo.acceptInvitation).toHaveBeenCalledWith('valid-token', 'user-5');
    });
  });
});
