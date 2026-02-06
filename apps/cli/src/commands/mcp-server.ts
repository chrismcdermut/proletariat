/**
 * MCP Server Command
 *
 * Starts an MCP (Model Context Protocol) server for AI agent integration.
 * This allows Claude Code and other MCP-compatible tools to call prlt
 * commands directly as tools.
 *
 * Usage in Claude Code config:
 * ```json
 * {
 *   "mcpServers": {
 *     "prlt": { "command": "prlt", "args": ["mcp-server"] }
 *   }
 * }
 * ```
 */

import { Command } from '@oclif/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getPMOContext, type PMOContext } from '../lib/pmo/pmo-context.js'
import type { Priority, TicketCategory, EpicStatus, SpecStatus, SpecType, Ticket, Project, Column, Spec, Epic } from '../lib/pmo/types.js'

export default class McpServerCommand extends Command {
  static description = 'Start MCP server for AI agent integration'

  static hidden = true // Not for human use - intended for MCP clients

  static examples = [
    '<%= config.bin %> mcp-server',
  ]

  private pmoContext: PMOContext | null = null

  async run(): Promise<void> {
    // Initialize PMO context (silently - no console output in MCP mode)
    try {
      this.pmoContext = await getPMOContext({
        logger: () => {}, // Silent logger for MCP mode
      })
    } catch {
      // PMO not initialized - some tools will fail, but server can still start
      this.pmoContext = null
    }

    // Create MCP server
    const server = new McpServer({
      name: 'prlt',
      version: this.config.version,
    })

    // Register all tools
    this.registerTicketTools(server)
    this.registerProjectTools(server)
    this.registerBoardTools(server)
    this.registerSpecTools(server)
    this.registerEpicTools(server)
    this.registerWorkTools(server)

    // Connect via stdio transport
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  private get storage() {
    if (!this.pmoContext) {
      throw new Error('PMO not initialized. Run "prlt init" first.')
    }
    return this.pmoContext.storage
  }

  // ===========================================================================
  // Ticket Tools
  // ===========================================================================

  private registerTicketTools(server: McpServer): void {
    // ticket_list - List tickets with optional filters
    server.tool(
      'ticket_list',
      'List tickets with optional filters',
      {
        project: z.string().optional().describe('Project ID to list tickets from'),
        column: z.string().optional().describe('Filter by column/status name'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Filter by priority'),
        category: z.string().optional().describe('Filter by category (feature, bug, etc.)'),
        assignee: z.string().optional().describe('Filter by assignee'),
        owner: z.string().optional().describe('Filter by owner'),
        search: z.string().optional().describe('Search in title/description'),
        all_projects: z.boolean().optional().describe('List tickets from all projects'),
      },
      async (params) => {
        try {
          const tickets = await this.storage.listTickets(
            params.all_projects ? undefined : params.project,
            {
              column: params.column,
              priority: params.priority,
              category: params.category,
              assignee: params.assignee,
              owner: params.owner,
              search: params.search,
              allProjects: params.all_projects,
            }
          )

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: tickets.length,
                tickets: tickets.map((t: Ticket) => ({
                  id: t.id,
                  title: t.title,
                  description: t.description,
                  priority: t.priority,
                  category: t.category,
                  statusName: t.statusName,
                  statusCategory: t.statusCategory,
                  projectId: t.projectId,
                  assignee: t.assignee,
                  owner: t.owner,
                  epicId: t.epicId,
                  createdAt: t.createdAt.toISOString(),
                  updatedAt: t.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // ticket_create - Create a new ticket
    server.tool(
      'ticket_create',
      'Create a new ticket',
      {
        title: z.string().describe('Ticket title (required)'),
        project: z.string().optional().describe('Project ID (uses first project if not specified)'),
        description: z.string().optional().describe('Ticket description'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Priority level'),
        category: z.string().optional().describe('Category (feature, bug, refactor, docs, etc.)'),
        column: z.string().optional().describe('Column/status name to place ticket in'),
        assignee: z.string().optional().describe('Who is assigned to work on this'),
        owner: z.string().optional().describe('Who is responsible for this ticket'),
        epic_id: z.string().optional().describe('Epic ID to link this ticket to'),
      },
      async (params) => {
        try {
          // Get project ID
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) {
              throw new Error('No projects found. Create a project first.')
            }
            projectId = projects[0].id
          }

          const ticket = await this.storage.createTicket(projectId, {
            title: params.title,
            description: params.description,
            priority: params.priority as Priority | undefined,
            category: params.category as TicketCategory | undefined,
            statusName: params.column,
            assignee: params.assignee,
            owner: params.owner,
            epicId: params.epic_id,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: ticket.id,
                  title: ticket.title,
                  description: ticket.description,
                  priority: ticket.priority,
                  category: ticket.category,
                  statusName: ticket.statusName,
                  projectId: ticket.projectId,
                  assignee: ticket.assignee,
                  owner: ticket.owner,
                  epicId: ticket.epicId,
                  createdAt: ticket.createdAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // ticket_show - Get ticket details
    server.tool(
      'ticket_show',
      'Get detailed information about a specific ticket',
      {
        id: z.string().describe('Ticket ID (e.g., TKT-123)'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.id)
          if (!ticket) {
            throw new Error(`Ticket not found: ${params.id}`)
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: ticket.id,
                  title: ticket.title,
                  description: ticket.description,
                  priority: ticket.priority,
                  category: ticket.category,
                  statusId: ticket.statusId,
                  statusName: ticket.statusName,
                  statusCategory: ticket.statusCategory,
                  projectId: ticket.projectId,
                  projectName: ticket.projectName,
                  assignee: ticket.assignee,
                  owner: ticket.owner,
                  branch: ticket.branch,
                  epicId: ticket.epicId,
                  specId: ticket.specId,
                  subtasks: ticket.subtasks,
                  labels: ticket.labels,
                  metadata: ticket.metadata,
                  blockedBy: ticket.blockedBy,
                  acceptanceCriteria: ticket.acceptanceCriteria,
                  createdAt: ticket.createdAt.toISOString(),
                  updatedAt: ticket.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // ticket_update - Update a ticket
    server.tool(
      'ticket_update',
      'Update an existing ticket',
      {
        id: z.string().describe('Ticket ID to update'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('New priority'),
        category: z.string().optional().describe('New category'),
        assignee: z.string().optional().describe('New assignee'),
        owner: z.string().optional().describe('New owner'),
        branch: z.string().optional().describe('Git branch for this ticket'),
      },
      async (params) => {
        try {
          const changes: Record<string, unknown> = {}
          if (params.title !== undefined) changes.title = params.title
          if (params.description !== undefined) changes.description = params.description
          if (params.priority !== undefined) changes.priority = params.priority
          if (params.category !== undefined) changes.category = params.category
          if (params.assignee !== undefined) changes.assignee = params.assignee
          if (params.owner !== undefined) changes.owner = params.owner
          if (params.branch !== undefined) changes.branch = params.branch

          const ticket = await this.storage.updateTicket(params.id, changes)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: ticket.id,
                  title: ticket.title,
                  description: ticket.description,
                  priority: ticket.priority,
                  category: ticket.category,
                  statusName: ticket.statusName,
                  assignee: ticket.assignee,
                  owner: ticket.owner,
                  branch: ticket.branch,
                  updatedAt: ticket.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // ticket_move - Move a ticket to a different column
    server.tool(
      'ticket_move',
      'Move a ticket to a different column/status',
      {
        id: z.string().describe('Ticket ID to move'),
        column: z.string().describe('Target column/status name'),
        position: z.number().optional().describe('Position within the column (0-indexed)'),
      },
      async (params) => {
        try {
          // Get ticket to find its project
          const ticket = await this.storage.getTicket(params.id)
          if (!ticket) {
            throw new Error(`Ticket not found: ${params.id}`)
          }

          const projectId = ticket.projectId
          if (!projectId) {
            throw new Error(`Ticket ${params.id} has no project assigned`)
          }

          const movedTicket = await this.storage.moveTicket(
            projectId,
            params.id,
            params.column,
            params.position
          )

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: movedTicket.id,
                  title: movedTicket.title,
                  statusName: movedTicket.statusName,
                  statusCategory: movedTicket.statusCategory,
                  projectId: movedTicket.projectId,
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // ticket_delete - Delete a ticket
    server.tool(
      'ticket_delete',
      'Delete a ticket',
      {
        id: z.string().describe('Ticket ID to delete'),
      },
      async (params) => {
        try {
          await this.storage.deleteTicket(params.id)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                message: `Ticket ${params.id} deleted`,
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  // ===========================================================================
  // Project Tools
  // ===========================================================================

  private registerProjectTools(server: McpServer): void {
    // project_list - List all projects
    server.tool(
      'project_list',
      'List all projects',
      {
        include_archived: z.boolean().optional().describe('Include archived projects'),
        search: z.string().optional().describe('Search in project name'),
      },
      async (params) => {
        try {
          const projects = await this.storage.listProjects({
            isArchived: params.include_archived ? undefined : false,
            search: params.search,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: projects.length,
                projects: projects.map((p: Project) => ({
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  template: p.template,
                  status: p.status,
                  isArchived: p.isArchived,
                  createdAt: p.createdAt.toISOString(),
                  updatedAt: p.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // project_create - Create a new project
    server.tool(
      'project_create',
      'Create a new project',
      {
        name: z.string().describe('Project name (required)'),
        description: z.string().optional().describe('Project description'),
        template: z.string().optional().describe('Board template (kanban, scrum, linear, simple)'),
      },
      async (params) => {
        try {
          const board = await this.storage.createProject({
            name: params.name,
            description: params.description,
            template: params.template,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                project: {
                  id: board.id,
                  name: board.name,
                  columns: board.columns.map((c: Column) => c.name),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // project_show - Get project details
    server.tool(
      'project_show',
      'Get detailed information about a specific project',
      {
        id: z.string().describe('Project ID'),
      },
      async (params) => {
        try {
          const project = await this.storage.getProject(params.id)
          if (!project) {
            throw new Error(`Project not found: ${params.id}`)
          }

          // Get ticket count
          const tickets = await this.storage.listTickets(params.id)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                project: {
                  id: project.id,
                  name: project.name,
                  description: project.description,
                  template: project.template,
                  status: project.status,
                  isArchived: project.isArchived,
                  ticketCount: tickets.length,
                  createdAt: project.createdAt.toISOString(),
                  updatedAt: project.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // project_archive - Archive a project
    server.tool(
      'project_archive',
      'Archive a project (soft delete)',
      {
        id: z.string().describe('Project ID to archive'),
      },
      async (params) => {
        try {
          const project = await this.storage.archiveProject(params.id)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                project: {
                  id: project.id,
                  name: project.name,
                  isArchived: project.isArchived,
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  // ===========================================================================
  // Board Tools
  // ===========================================================================

  private registerBoardTools(server: McpServer): void {
    // board_show - Show the kanban board
    server.tool(
      'board_show',
      'Show the kanban board for a project',
      {
        project: z.string().optional().describe('Project ID (uses first project if not specified)'),
      },
      async (params) => {
        try {
          // Get project ID
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) {
              throw new Error('No projects found. Create a project first.')
            }
            projectId = projects[0].id
          }

          const board = await this.storage.getBoard(projectId)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                board: {
                  id: board.id,
                  name: board.name,
                  columns: board.columns.map((col: Column) => ({
                    name: col.name,
                    position: col.position,
                    ticketCount: col.tickets.length,
                    tickets: col.tickets.map((t: Ticket) => ({
                      id: t.id,
                      title: t.title,
                      priority: t.priority,
                      assignee: t.assignee,
                    })),
                  })),
                  updatedAt: board.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // board_columns - Get column names for a project
    server.tool(
      'board_columns',
      'Get the column names (statuses) for a project board',
      {
        project: z.string().optional().describe('Project ID (uses first project if not specified)'),
      },
      async (params) => {
        try {
          // Get project ID
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) {
              throw new Error('No projects found. Create a project first.')
            }
            projectId = projects[0].id
          }

          const columns = this.storage.getColumnNames(projectId)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                projectId,
                columns,
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  // ===========================================================================
  // Spec Tools
  // ===========================================================================

  private registerSpecTools(server: McpServer): void {
    // spec_list - List specs
    server.tool(
      'spec_list',
      'List specifications',
      {
        status: z.enum(['draft', 'active', 'implemented']).optional().describe('Filter by status'),
        type: z.enum(['product', 'platform', 'infra', 'integration']).optional().describe('Filter by type'),
        search: z.string().optional().describe('Search in title'),
      },
      async (params) => {
        try {
          const specs = await this.storage.listSpecs({
            status: params.status as SpecStatus | undefined,
            type: params.type as SpecType | undefined,
            search: params.search,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: specs.length,
                specs: specs.map((s: Spec) => ({
                  id: s.id,
                  title: s.title,
                  status: s.status,
                  type: s.type,
                  tags: s.tags,
                  createdAt: s.createdAt.toISOString(),
                  updatedAt: s.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // spec_create - Create a new spec
    server.tool(
      'spec_create',
      'Create a new specification',
      {
        title: z.string().describe('Spec title (required)'),
        status: z.enum(['draft', 'active', 'implemented']).optional().describe('Initial status'),
        type: z.enum(['product', 'platform', 'infra', 'integration']).optional().describe('Spec type'),
        problem: z.string().optional().describe('Problem statement'),
        solution: z.string().optional().describe('Solution description'),
        acceptance_criteria: z.string().optional().describe('Acceptance criteria'),
      },
      async (params) => {
        try {
          const spec = await this.storage.createSpec({
            title: params.title,
            status: (params.status as SpecStatus) || 'draft',
            type: params.type as SpecType | undefined,
            problem: params.problem,
            solution: params.solution,
            acceptanceCriteria: params.acceptance_criteria,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                spec: {
                  id: spec.id,
                  title: spec.title,
                  status: spec.status,
                  type: spec.type,
                  createdAt: spec.createdAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // spec_show - Get spec details
    server.tool(
      'spec_show',
      'Get detailed information about a specification',
      {
        id: z.string().describe('Spec ID'),
      },
      async (params) => {
        try {
          const spec = await this.storage.getSpec(params.id)
          if (!spec) {
            throw new Error(`Spec not found: ${params.id}`)
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                spec: {
                  id: spec.id,
                  title: spec.title,
                  status: spec.status,
                  type: spec.type,
                  tags: spec.tags,
                  problem: spec.problem,
                  solution: spec.solution,
                  decisions: spec.decisions,
                  notNow: spec.notNow,
                  uiUx: spec.uiUx,
                  acceptanceCriteria: spec.acceptanceCriteria,
                  openQuestions: spec.openQuestions,
                  requirementsFunctional: spec.requirementsFunctional,
                  requirementsTechnical: spec.requirementsTechnical,
                  context: spec.context,
                  createdAt: spec.createdAt.toISOString(),
                  updatedAt: spec.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  // ===========================================================================
  // Epic Tools
  // ===========================================================================

  private registerEpicTools(server: McpServer): void {
    // epic_list - List epics
    server.tool(
      'epic_list',
      'List epics for a project',
      {
        project: z.string().optional().describe('Project ID (uses first project if not specified)'),
        status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional().describe('Filter by status'),
        search: z.string().optional().describe('Search in title'),
      },
      async (params) => {
        try {
          // Get project ID
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) {
              throw new Error('No projects found. Create a project first.')
            }
            projectId = projects[0].id
          }

          const epics = await this.storage.listEpics(projectId, {
            status: params.status as EpicStatus | undefined,
            search: params.search,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: epics.length,
                epics: epics.map((e: Epic) => ({
                  id: e.id,
                  title: e.title,
                  description: e.description,
                  status: e.status,
                  position: e.position,
                  projectId: e.projectId,
                  specId: e.specId,
                  createdAt: e.createdAt.toISOString(),
                  updatedAt: e.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // epic_create - Create a new epic
    server.tool(
      'epic_create',
      'Create a new epic',
      {
        title: z.string().describe('Epic title (required)'),
        project: z.string().optional().describe('Project ID (uses first project if not specified)'),
        description: z.string().optional().describe('Epic description'),
        status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional().describe('Initial status'),
        spec_id: z.string().optional().describe('Link to a spec'),
      },
      async (params) => {
        try {
          // Get project ID
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) {
              throw new Error('No projects found. Create a project first.')
            }
            projectId = projects[0].id
          }

          const epic = await this.storage.createEpic(projectId, {
            title: params.title,
            description: params.description,
            status: (params.status as EpicStatus) || 'draft',
            specId: params.spec_id,
          })

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                epic: {
                  id: epic.id,
                  title: epic.title,
                  description: epic.description,
                  status: epic.status,
                  projectId: epic.projectId,
                  specId: epic.specId,
                  createdAt: epic.createdAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // epic_show - Get epic details
    server.tool(
      'epic_show',
      'Get detailed information about an epic including its tickets',
      {
        id: z.string().describe('Epic ID'),
      },
      async (params) => {
        try {
          const epic = await this.storage.getEpic(params.id)
          if (!epic) {
            throw new Error(`Epic not found: ${params.id}`)
          }

          // Get tickets for this epic
          const tickets = await this.storage.getTicketsForEpic(epic.projectId, params.id)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                epic: {
                  id: epic.id,
                  title: epic.title,
                  description: epic.description,
                  status: epic.status,
                  position: epic.position,
                  projectId: epic.projectId,
                  specId: epic.specId,
                  filePath: epic.filePath,
                  ticketCount: tickets.length,
                  tickets: tickets.map((t: Ticket) => ({
                    id: t.id,
                    title: t.title,
                    statusName: t.statusName,
                    priority: t.priority,
                  })),
                  createdAt: epic.createdAt.toISOString(),
                  updatedAt: epic.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  // ===========================================================================
  // Work Tools (Agent Workflow)
  // ===========================================================================

  private registerWorkTools(server: McpServer): void {
    // work_status - Get current work status for an agent
    server.tool(
      'work_status',
      'Get the current ticket/work status (what is the agent working on)',
      {},
      async () => {
        try {
          // Find tickets assigned to any agent that are in progress
          const tickets = await this.storage.listTickets(undefined, {
            allProjects: true,
          })

          // Find tickets with "started" status category (in progress)
          const inProgressTickets = tickets.filter((t: Ticket) =>
            t.statusCategory === 'started' && t.assignee
          )

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                inProgressCount: inProgressTickets.length,
                tickets: inProgressTickets.map((t: Ticket) => ({
                  id: t.id,
                  title: t.title,
                  assignee: t.assignee,
                  owner: t.owner,
                  statusName: t.statusName,
                  priority: t.priority,
                  projectId: t.projectId,
                  branch: t.branch,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // work_start - Start working on a ticket
    server.tool(
      'work_start',
      'Start working on a ticket (moves it to In Progress)',
      {
        ticket_id: z.string().describe('Ticket ID to start working on'),
        assignee: z.string().optional().describe('Who is working on it'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) {
            throw new Error(`Ticket not found: ${params.ticket_id}`)
          }

          // Update assignee if provided
          if (params.assignee) {
            await this.storage.updateTicket(params.ticket_id, {
              assignee: params.assignee,
            })
          }

          // Find an "In Progress" column in the project
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const progressColumn = columns.find((c: string) =>
            c.toLowerCase().includes('progress') ||
            c.toLowerCase().includes('doing') ||
            c.toLowerCase().includes('working')
          ) || columns[Math.min(1, columns.length - 1)]

          // Move to in progress
          const movedTicket = await this.storage.moveTicket(
            ticket.projectId!,
            params.ticket_id,
            progressColumn
          )

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: movedTicket.id,
                  title: movedTicket.title,
                  statusName: movedTicket.statusName,
                  assignee: movedTicket.assignee,
                },
                message: `Started working on ${movedTicket.id}: ${movedTicket.title}`,
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // work_complete - Mark work as complete
    server.tool(
      'work_complete',
      'Mark a ticket as complete (moves it to Done)',
      {
        ticket_id: z.string().describe('Ticket ID to mark complete'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) {
            throw new Error(`Ticket not found: ${params.ticket_id}`)
          }

          // Find a "Done" column in the project
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const doneColumn = columns.find((c: string) =>
            c.toLowerCase().includes('done') ||
            c.toLowerCase().includes('complete') ||
            c.toLowerCase().includes('finished')
          ) || columns[columns.length - 1]

          // Move to done
          const movedTicket = await this.storage.moveTicket(
            ticket.projectId!,
            params.ticket_id,
            doneColumn
          )

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: {
                  id: movedTicket.id,
                  title: movedTicket.title,
                  statusName: movedTicket.statusName,
                },
                message: `Completed ${movedTicket.id}: ${movedTicket.title}`,
              }, null, 2),
            }],
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )

    // work_ready - Mark ticket as ready for review
    server.tool(
      'work_ready',
      'Mark a ticket as ready for review',
      {
        ticket_id: z.string().describe('Ticket ID to mark ready'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) {
            throw new Error(`Ticket not found: ${params.ticket_id}`)
          }

          // Find a "Review" column in the project
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const reviewColumn = columns.find((c: string) =>
            c.toLowerCase().includes('review') ||
            c.toLowerCase().includes('ready')
          )

          if (reviewColumn) {
            // Move to review
            const movedTicket = await this.storage.moveTicket(
              ticket.projectId!,
              params.ticket_id,
              reviewColumn
            )

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  ticket: {
                    id: movedTicket.id,
                    title: movedTicket.title,
                    statusName: movedTicket.statusName,
                  },
                  message: `${movedTicket.id} is ready for review`,
                }, null, 2),
              }],
            }
          } else {
            // No review column, just return current status
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  ticket: {
                    id: ticket.id,
                    title: ticket.title,
                    statusName: ticket.statusName,
                  },
                  message: `No review column found. Ticket remains in ${ticket.statusName}`,
                }, null, 2),
              }],
            }
          }
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            }],
            isError: true,
          }
        }
      }
    )
  }

  async catch(error: Error & { exitCode?: number }): Promise<void> {
    // Close PMO context on error
    if (this.pmoContext?.storage) {
      try {
        await this.pmoContext.storage.close()
      } catch {
        // Ignore close errors
      }
    }
    throw error
  }

  async finally(_: Error | undefined): Promise<void> {
    // Close PMO context on exit
    if (this.pmoContext?.storage) {
      try {
        await this.pmoContext.storage.close()
      } catch {
        // Ignore close errors
      }
    }
  }
}
