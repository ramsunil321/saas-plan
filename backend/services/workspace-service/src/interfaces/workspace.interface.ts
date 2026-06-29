// =============================================================================
// WORKSPACE INTERFACES — TypeScript contracts for all workspace resources
// =============================================================================
import { User, Organization, OrganizationMember, Team, TeamMember, Project, Board } from '@prisma/client';

// =============================================================================
// SAFE / PUBLIC RESPONSE TYPES — Strip internal fields before sending to client
// =============================================================================

export interface SafeOrganization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  plan: string;
  createdAt: Date;
}

export interface OrganizationWithRole extends SafeOrganization {
  role: string; // The requesting user's role in this org
  memberCount: number;
}

export interface SafeMember {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  joinedAt: Date;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl: string | null;
  };
}

export interface SafeTeam {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  createdAt: Date;
  memberCount?: number;
}

export interface SafeProject {
  id: string;
  name: string;
  description: string | null;
  key: string;
  status: string;
  organizationId: string;
  teamId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeBoard {
  id: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
  projectId: string;
}

// =============================================================================
// PAGINATION
// =============================================================================

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// =============================================================================
// ORGANIZATION REPOSITORY INTERFACE
// =============================================================================

export interface IOrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  findUserOrganizations(userId: string): Promise<Array<Organization & { members: OrganizationMember[] }>>;
  create(data: CreateOrganizationData): Promise<Organization>;
  update(id: string, data: UpdateOrganizationData): Promise<Organization>;
  delete(id: string): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;

  // Member management
  findMember(organizationId: string, userId: string): Promise<OrganizationMember | null>;
  listMembers(organizationId: string): Promise<SafeMember[]>;
  addMember(data: AddMemberData): Promise<OrganizationMember>;
  updateMemberRole(organizationId: string, userId: string, role: string): Promise<OrganizationMember>;
  removeMember(organizationId: string, userId: string): Promise<void>;

  // Invitations
  createInvitation(data: CreateInvitationData): Promise<{ id: string; token: string; email: string }>;
  findInvitationByToken(token: string): Promise<InvitationRecord | null>;
  acceptInvitation(token: string, userId: string): Promise<void>;
  listPendingInvitations(organizationId: string): Promise<InvitationRecord[]>;
}

// =============================================================================
// TEAM REPOSITORY INTERFACE
// =============================================================================

export interface ITeamRepository {
  findById(organizationId: string, teamId: string): Promise<Team | null>;
  list(organizationId: string): Promise<SafeTeam[]>;
  create(data: CreateTeamData): Promise<Team>;
  update(organizationId: string, teamId: string, data: UpdateTeamData): Promise<Team>;
  delete(organizationId: string, teamId: string): Promise<void>;
  addMember(teamId: string, userId: string, role?: string): Promise<TeamMember>;
  removeMember(teamId: string, userId: string): Promise<void>;
  listMembers(teamId: string): Promise<SafeMember[]>;
}

// =============================================================================
// PROJECT REPOSITORY INTERFACE
// =============================================================================

export interface IProjectRepository {
  findById(organizationId: string, projectId: string): Promise<Project | null>;
  list(organizationId: string, pagination: PaginationParams): Promise<PaginatedResult<SafeProject>>;
  create(data: CreateProjectData): Promise<Project>;
  update(organizationId: string, projectId: string, data: UpdateProjectData): Promise<Project>;
  archive(organizationId: string, projectId: string): Promise<Project>;
  delete(organizationId: string, projectId: string): Promise<void>;
  generateNextTaskNumber(projectId: string): Promise<number>;
}

// =============================================================================
// BOARD REPOSITORY INTERFACE
// =============================================================================

export interface IBoardRepository {
  list(organizationId: string, projectId: string): Promise<Board[]>;
  findById(organizationId: string, boardId: string): Promise<Board | null>;
  create(data: CreateBoardData): Promise<Board>;
  update(organizationId: string, boardId: string, data: UpdateBoardData): Promise<Board>;
  delete(organizationId: string, boardId: string): Promise<void>;
  reorder(organizationId: string, projectId: string, boardIds: string[]): Promise<void>;
  createDefaultBoards(organizationId: string, projectId: string): Promise<Board[]>;
}

// =============================================================================
// INPUT DATA TYPES (create/update)
// =============================================================================

export interface CreateOrganizationData {
  name: string;
  slug: string;
  description?: string;
  createdBy: string;
}

export interface UpdateOrganizationData {
  name?: string;
  description?: string;
  logoUrl?: string;
  plan?: string;
}

export interface AddMemberData {
  organizationId: string;
  userId: string;
  role: string;
  invitedBy?: string;
}

export interface CreateInvitationData {
  organizationId: string;
  email: string;
  role: string;
  invitedBy: string;
  token: string;
  expiresAt: Date;
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  token: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  inviter?: { firstName: string; lastName: string; email: string };
}

export interface CreateTeamData {
  organizationId: string;
  name: string;
  description?: string;
  createdBy: string;
}

export interface UpdateTeamData {
  name?: string;
  description?: string;
}

export interface CreateProjectData {
  organizationId: string;
  teamId?: string;
  name: string;
  description?: string;
  key: string;
  startDate?: Date;
  endDate?: Date;
  createdBy: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string;
  teamId?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  status?: string;
}

export interface CreateBoardData {
  projectId: string;
  organizationId: string;
  name: string;
  position: number;
  color?: string;
  isDefault?: boolean;
}

export interface UpdateBoardData {
  name?: string;
  color?: string;
  position?: number;
}
