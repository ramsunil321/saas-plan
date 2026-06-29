// =============================================================================
// BOARD REPOSITORY — Kanban column management
// =============================================================================
import { prisma } from '../config/database';
import { Board } from '@prisma/client';
import { IBoardRepository, CreateBoardData, UpdateBoardData } from '../interfaces/workspace.interface';

// Default Kanban columns created with every new project
// Position values: 0, 1, 2, 3, 4 (integer ordering for columns)
const DEFAULT_BOARDS = [
  { name: 'Backlog',     position: 0, color: '#94A3B8', isDefault: true },
  { name: 'Todo',        position: 1, color: '#60A5FA', isDefault: true },
  { name: 'In Progress', position: 2, color: '#FBBF24', isDefault: true },
  { name: 'In Review',   position: 3, color: '#A78BFA', isDefault: true },
  { name: 'Done',        position: 4, color: '#34D399', isDefault: true },
];

export class BoardRepository implements IBoardRepository {

  async list(organizationId: string, projectId: string): Promise<Board[]> {
    return prisma.board.findMany({
      where: { organizationId, projectId }, // Both for tenant isolation + project scoping
      orderBy: { position: 'asc' },         // Always sorted left-to-right by position
    });
  }

  async findById(organizationId: string, boardId: string): Promise<Board | null> {
    return prisma.board.findFirst({
      where: { id: boardId, organizationId },
    });
  }

  async create(data: CreateBoardData): Promise<Board> {
    return prisma.board.create({
      data: {
        projectId: data.projectId,
        organizationId: data.organizationId,
        name: data.name,
        position: data.position,
        color: data.color,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async update(organizationId: string, boardId: string, data: UpdateBoardData): Promise<Board> {
    return prisma.board.update({
      where: { id: boardId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.position !== undefined && { position: data.position }),
      },
    });
  }

  async delete(organizationId: string, boardId: string): Promise<void> {
    await prisma.board.deleteMany({ where: { id: boardId, organizationId } });
  }

  // Reorder boards: given an ordered array of boardIds, set position = index
  // This is the drag-and-drop column reordering operation.
  // Uses a transaction to ensure all updates succeed or all fail.
  async reorder(organizationId: string, projectId: string, boardIds: string[]): Promise<void> {
    await prisma.$transaction(
      boardIds.map((boardId, index) =>
        prisma.board.update({
          where: { id: boardId },
          data: { position: index },
        }),
      ),
    );
  }

  // Create the 5 default Kanban columns when a new project is created.
  // Called from ProjectService.create() inside a transaction.
  async createDefaultBoards(organizationId: string, projectId: string): Promise<Board[]> {
    // createMany is more efficient than N individual creates for bulk inserts
    await prisma.board.createMany({
      data: DEFAULT_BOARDS.map((board) => ({
        ...board,
        projectId,
        organizationId,
      })),
    });

    // Return the created boards in position order
    return prisma.board.findMany({
      where: { projectId, organizationId },
      orderBy: { position: 'asc' },
    });
  }
}
