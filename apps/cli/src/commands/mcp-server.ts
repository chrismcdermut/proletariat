/**
 * MCP Server Command
 *
 * Comprehensive MCP (Model Context Protocol) server exposing ALL prlt commands
 * as tools for AI agent integration.
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
import type {
  Ticket,
  Project,
  Column,
  Spec,
  Epic,
  Workflow,
  WorkflowStatus,
  ProjectPhase,
  PhaseTemplate,
  WorkAction,
  Roadmap,
  Category,
  TicketTemplate,
  BoardView,
} from '../lib/pmo/types.js'
import { execSync } from 'node:child_process'
import * as path from 'node:path'

export default class McpServerCommand extends Command {
  static description = 'Start MCP server for AI agent integration (exposes all prlt commands as tools)'

  static hidden = true

  static examples = ['<%= config.bin %> mcp-server']

  private pmoContext: PMOContext | null = null

  async run(): Promise<void> {
    try {
      this.pmoContext = await getPMOContext({ logger: () => {} })
    } catch {
      this.pmoContext = null
    }

    const server = new McpServer({
      name: 'prlt',
      version: this.config.version,
    })

    // Register ALL tool categories
    this.registerTicketTools(server)
    this.registerProjectTools(server)
    this.registerBoardTools(server)
    this.registerSpecTools(server)
    this.registerEpicTools(server)
    this.registerWorkTools(server)
    this.registerWorkflowTools(server)
    this.registerStatusTools(server)
    this.registerPhaseTools(server)
    this.registerActionTools(server)
    this.registerRoadmapTools(server)
    this.registerCategoryTools(server)
    this.registerTemplateTools(server)
    this.registerViewTools(server)
    this.registerAgentTools(server)
    this.registerDockerTools(server)
    this.registerRepoTools(server)
    this.registerBranchTools(server)
    this.registerGitHubTools(server)
    this.registerInitTools(server)
    this.registerUtilityTools(server)

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  private get storage() {
    if (!this.pmoContext) {
      throw new Error('PMO not initialized. Run "prlt init" first.')
    }
    return this.pmoContext.storage
  }

  // Helper to run CLI commands and return output
  private runCommand(cmd: string): string {
    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 60000,
      })
      return result
    } catch (error: unknown) {
      const e = error as { stderr?: string; message?: string }
      throw new Error(e.stderr || e.message || 'Command failed')
    }
  }

  // ===========================================================================
  // TICKET TOOLS (Complete)
  // ===========================================================================

  private registerTicketTools(server: McpServer): void {
    server.tool(
      'ticket_list',
      'List tickets with optional filters',
      {
        project: z.string().optional().describe('Project ID'),
        column: z.string().optional().describe('Filter by column/status'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Filter by priority'),
        category: z.string().optional().describe('Filter by category'),
        assignee: z.string().optional().describe('Filter by assignee'),
        owner: z.string().optional().describe('Filter by owner'),
        search: z.string().optional().describe('Search in title/description'),
        epic: z.string().optional().describe('Filter by epic ID'),
        all_projects: z.boolean().optional().describe('List from all projects'),
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
              epic: params.epic,
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
                  branch: t.branch,
                  createdAt: t.createdAt.toISOString(),
                  updatedAt: t.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_create',
      'Create a new ticket',
      {
        title: z.string().describe('Ticket title (required)'),
        project: z.string().optional().describe('Project ID'),
        description: z.string().optional().describe('Ticket description'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Priority'),
        category: z.string().optional().describe('Category (feature, bug, etc.)'),
        column: z.string().optional().describe('Column/status name'),
        assignee: z.string().optional().describe('Assignee'),
        owner: z.string().optional().describe('Owner'),
        epic_id: z.string().optional().describe('Epic ID to link'),
        labels: z.array(z.string()).optional().describe('Labels to add'),
        subtasks: z.array(z.string()).optional().describe('Subtasks to add'),
      },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects found')
            projectId = projects[0].id
          }
          const ticket = await this.storage.createTicket(projectId, {
            title: params.title,
            description: params.description,
            priority: params.priority,
            category: params.category,
            statusName: params.column,
            assignee: params.assignee,
            owner: params.owner,
            epicId: params.epic_id,
            labels: params.labels,
            subtasks: params.subtasks?.map((title) => ({ id: '', title, done: false })),
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: this.formatTicket(ticket) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_show',
      'Get detailed ticket information',
      { id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.id)
          if (!ticket) throw new Error(`Ticket not found: ${params.id}`)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: this.formatTicketFull(ticket) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_update',
      'Update a ticket',
      {
        id: z.string().describe('Ticket ID'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('New priority'),
        category: z.string().optional().describe('New category'),
        assignee: z.string().optional().describe('New assignee'),
        owner: z.string().optional().describe('New owner'),
        branch: z.string().optional().describe('Git branch'),
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
              text: JSON.stringify({ success: true, ticket: this.formatTicket(ticket) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_move',
      'Move ticket to a different column/status',
      {
        id: z.string().describe('Ticket ID'),
        column: z.string().describe('Target column/status'),
        position: z.number().optional().describe('Position in column'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.id)
          if (!ticket) throw new Error(`Ticket not found: ${params.id}`)
          const moved = await this.storage.moveTicket(ticket.projectId!, params.id, params.column, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: this.formatTicket(moved) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_delete',
      'Delete a ticket',
      { id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          await this.storage.deleteTicket(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `Deleted ${params.id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_move_to_project',
      'Move ticket to a different project',
      {
        id: z.string().describe('Ticket ID'),
        project: z.string().describe('Target project ID'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.moveTicketToProject(params.id, params.project)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: this.formatTicket(ticket) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_add_subtask',
      'Add a subtask to a ticket',
      {
        ticket_id: z.string().describe('Ticket ID'),
        title: z.string().describe('Subtask title'),
      },
      async (params) => {
        try {
          const subtask = await this.storage.addSubtask(params.ticket_id, params.title)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, subtask }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_toggle_subtask',
      'Toggle subtask completion',
      {
        ticket_id: z.string().describe('Ticket ID'),
        subtask_id: z.string().describe('Subtask ID'),
      },
      async (params) => {
        try {
          const subtask = await this.storage.toggleSubtask(params.ticket_id, params.subtask_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, subtask }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_remove_subtask',
      'Remove a subtask',
      {
        ticket_id: z.string().describe('Ticket ID'),
        subtask_id: z.string().describe('Subtask ID'),
      },
      async (params) => {
        try {
          await this.storage.removeSubtask(params.ticket_id, params.subtask_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Subtask removed' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_add_acceptance_criterion',
      'Add acceptance criterion to a ticket',
      {
        ticket_id: z.string().describe('Ticket ID'),
        criterion: z.string().describe('Acceptance criterion text'),
      },
      async (params) => {
        try {
          const ac = await this.storage.addAcceptanceCriterion(params.ticket_id, params.criterion)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, acceptanceCriterion: ac }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_remove_acceptance_criterion',
      'Remove acceptance criterion',
      {
        ticket_id: z.string().describe('Ticket ID'),
        criterion_id: z.string().describe('Criterion ID'),
      },
      async (params) => {
        try {
          await this.storage.removeAcceptanceCriterion(params.ticket_id, params.criterion_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Criterion removed' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_link_to_epic',
      'Link ticket to an epic',
      {
        ticket_id: z.string().describe('Ticket ID'),
        epic_id: z.string().describe('Epic ID'),
      },
      async (params) => {
        try {
          await this.storage.linkTicketToEpic(params.ticket_id, params.epic_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Ticket linked to epic' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_unlink_from_epic',
      'Unlink ticket from its epic',
      { ticket_id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          await this.storage.unlinkTicketFromEpic(params.ticket_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Ticket unlinked from epic' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_link_to_spec',
      'Link ticket to a spec',
      {
        ticket_id: z.string().describe('Ticket ID'),
        spec_id: z.string().describe('Spec ID'),
      },
      async (params) => {
        try {
          await this.storage.linkTicketToSpec(params.ticket_id, params.spec_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Ticket linked to spec' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_add_blocker',
      'Add a blocking dependency',
      {
        ticket_id: z.string().describe('Ticket that will be blocked'),
        blocker_id: z.string().describe('Ticket that blocks'),
      },
      async (params) => {
        try {
          await this.storage.createTicketDependency(params.ticket_id, params.blocker_id, 'blocks')
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `${params.ticket_id} is now blocked by ${params.blocker_id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_remove_blocker',
      'Remove a blocking dependency',
      {
        ticket_id: z.string().describe('Blocked ticket'),
        blocker_id: z.string().describe('Blocking ticket'),
      },
      async (params) => {
        try {
          await this.storage.deleteTicketDependency(params.ticket_id, params.blocker_id, 'blocks')
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Blocker removed' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_get_blockers',
      'Get tickets blocking this ticket',
      { ticket_id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          const blockers = await this.storage.getTicketBlockers(params.ticket_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                blockers: blockers.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // PROJECT TOOLS (Complete)
  // ===========================================================================

  private registerProjectTools(server: McpServer): void {
    server.tool(
      'project_list',
      'List all projects',
      {
        include_archived: z.boolean().optional().describe('Include archived'),
        search: z.string().optional().describe('Search in name'),
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
                  workflowId: p.workflowId,
                  createdAt: p.createdAt.toISOString(),
                  updatedAt: p.updatedAt.toISOString(),
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_create',
      'Create a new project',
      {
        name: z.string().describe('Project name'),
        description: z.string().optional().describe('Description'),
        template: z.string().optional().describe('Template (kanban, scrum, linear, simple)'),
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
                project: { id: board.id, name: board.name, columns: board.columns.map((c: Column) => c.name) },
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_show',
      'Get project details',
      { id: z.string().describe('Project ID') },
      async (params) => {
        try {
          const project = await this.storage.getProject(params.id)
          if (!project) throw new Error(`Project not found: ${params.id}`)
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
                  workflowId: project.workflowId,
                  ticketCount: tickets.length,
                  createdAt: project.createdAt.toISOString(),
                  updatedAt: project.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_update',
      'Update a project',
      {
        id: z.string().describe('Project ID'),
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description'),
      },
      async (params) => {
        try {
          const changes: Partial<Project> = {}
          if (params.name) changes.name = params.name
          if (params.description !== undefined) changes.description = params.description
          const project = await this.storage.updateProject(params.id, changes)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, project: { id: project.id, name: project.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_archive',
      'Archive a project',
      { id: z.string().describe('Project ID') },
      async (params) => {
        try {
          const project = await this.storage.archiveProject(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, project: { id: project.id, isArchived: project.isArchived } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_unarchive',
      'Unarchive a project',
      { id: z.string().describe('Project ID') },
      async (params) => {
        try {
          const project = await this.storage.unarchiveProject(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, project: { id: project.id, isArchived: project.isArchived } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_delete',
      'Delete a project',
      { id: z.string().describe('Project ID') },
      async (params) => {
        try {
          await this.storage.deleteProject(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `Deleted project ${params.id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_link_to_spec',
      'Link project to a spec',
      {
        project_id: z.string().describe('Project ID'),
        spec_id: z.string().describe('Spec ID'),
      },
      async (params) => {
        try {
          await this.storage.linkProjectToSpec(params.project_id, params.spec_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Project linked to spec' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'project_get_specs',
      'Get specs linked to a project',
      { project_id: z.string().describe('Project ID') },
      async (params) => {
        try {
          const specs = await this.storage.getSpecsForProject(params.project_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                specs: specs.map((s: Spec) => ({ id: s.id, title: s.title, status: s.status })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // BOARD TOOLS
  // ===========================================================================

  private registerBoardTools(server: McpServer): void {
    server.tool(
      'board_show',
      'Show the kanban board',
      { project: z.string().optional().describe('Project ID') },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects found')
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
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'board_columns',
      'Get column names for a project',
      { project: z.string().optional().describe('Project ID') },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects found')
            projectId = projects[0].id
          }
          const columns = this.storage.getColumnNames(projectId)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, projectId, columns }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'board_create_column',
      'Add a new column to the board',
      {
        project: z.string().describe('Project ID'),
        name: z.string().describe('Column name'),
        position: z.number().optional().describe('Position'),
      },
      async (params) => {
        try {
          const column = await this.storage.createColumn(params.project, params.name, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, column: { id: column.id, name: column.name, position: column.position } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'board_rename_column',
      'Rename a column',
      {
        project: z.string().describe('Project ID'),
        column_id: z.string().describe('Column ID'),
        name: z.string().describe('New name'),
      },
      async (params) => {
        try {
          const column = await this.storage.renameColumn(params.project, params.column_id, params.name)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, column: { id: column.id, name: column.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'board_move_column',
      'Reorder a column',
      {
        project: z.string().describe('Project ID'),
        column_id: z.string().describe('Column ID'),
        position: z.number().describe('New position'),
      },
      async (params) => {
        try {
          const column = await this.storage.moveColumn(params.project, params.column_id, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, column: { id: column.id, name: column.name, position: column.position } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'board_delete_column',
      'Delete a column',
      {
        project: z.string().describe('Project ID'),
        column_id: z.string().describe('Column ID'),
        cascade: z.boolean().optional().describe('Delete tickets in column'),
      },
      async (params) => {
        try {
          await this.storage.deleteColumn(params.project, params.column_id, params.cascade)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Column deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // SPEC TOOLS (Complete)
  // ===========================================================================

  private registerSpecTools(server: McpServer): void {
    server.tool(
      'spec_list',
      'List specifications',
      {
        status: z.enum(['draft', 'active', 'implemented']).optional(),
        type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
        search: z.string().optional(),
      },
      async (params) => {
        try {
          const specs = await this.storage.listSpecs({
            status: params.status,
            type: params.type,
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
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_create',
      'Create a specification',
      {
        title: z.string().describe('Spec title'),
        status: z.enum(['draft', 'active', 'implemented']).optional(),
        type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
        problem: z.string().optional(),
        solution: z.string().optional(),
        acceptance_criteria: z.string().optional(),
        context: z.string().optional(),
      },
      async (params) => {
        try {
          const spec = await this.storage.createSpec({
            title: params.title,
            status: params.status || 'draft',
            type: params.type,
            problem: params.problem,
            solution: params.solution,
            acceptanceCriteria: params.acceptance_criteria,
            context: params.context,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, spec: { id: spec.id, title: spec.title, status: spec.status } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_show',
      'Get spec details',
      { id: z.string().describe('Spec ID') },
      async (params) => {
        try {
          const spec = await this.storage.getSpec(params.id)
          if (!spec) throw new Error(`Spec not found: ${params.id}`)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, spec }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_update',
      'Update a spec',
      {
        id: z.string().describe('Spec ID'),
        title: z.string().optional(),
        status: z.enum(['draft', 'active', 'implemented']).optional(),
        type: z.enum(['product', 'platform', 'infra', 'integration']).optional(),
        problem: z.string().optional(),
        solution: z.string().optional(),
        acceptance_criteria: z.string().optional(),
      },
      async (params) => {
        try {
          const changes: Partial<Spec> = {}
          if (params.title) changes.title = params.title
          if (params.status) changes.status = params.status
          if (params.type) changes.type = params.type
          if (params.problem !== undefined) changes.problem = params.problem
          if (params.solution !== undefined) changes.solution = params.solution
          if (params.acceptance_criteria !== undefined) changes.acceptanceCriteria = params.acceptance_criteria
          const spec = await this.storage.updateSpec(params.id, changes)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, spec: { id: spec.id, title: spec.title } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_delete',
      'Delete a spec',
      { id: z.string().describe('Spec ID') },
      async (params) => {
        try {
          await this.storage.deleteSpec(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `Deleted spec ${params.id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_add_dependency',
      'Add spec dependency',
      {
        spec_id: z.string().describe('Spec ID'),
        depends_on_id: z.string().describe('ID of spec this depends on'),
      },
      async (params) => {
        try {
          await this.storage.addSpecDependency(params.spec_id, params.depends_on_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Dependency added' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_get_dependencies',
      'Get spec dependencies',
      { spec_id: z.string().describe('Spec ID') },
      async (params) => {
        try {
          const deps = await this.storage.getSpecDependencies(params.spec_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                dependencies: deps.map((s: Spec) => ({ id: s.id, title: s.title })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'spec_get_tickets',
      'Get tickets linked to a spec',
      {
        spec_id: z.string().describe('Spec ID'),
        project: z.string().optional().describe('Project ID'),
      },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects')
            projectId = projects[0].id
          }
          const tickets = await this.storage.getTicketsForSpec(projectId, params.spec_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                tickets: tickets.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // EPIC TOOLS (Complete)
  // ===========================================================================

  private registerEpicTools(server: McpServer): void {
    server.tool(
      'epic_list',
      'List epics',
      {
        project: z.string().optional(),
        status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
        search: z.string().optional(),
      },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects')
            projectId = projects[0].id
          }
          const epics = await this.storage.listEpics(projectId, { status: params.status, search: params.search })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: epics.length,
                epics: epics.map((e: Epic) => ({
                  id: e.id,
                  title: e.title,
                  status: e.status,
                  position: e.position,
                  projectId: e.projectId,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_create',
      'Create an epic',
      {
        title: z.string().describe('Epic title'),
        project: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
        spec_id: z.string().optional(),
      },
      async (params) => {
        try {
          let projectId = params.project
          if (!projectId) {
            const projects = await this.storage.listProjects()
            if (projects.length === 0) throw new Error('No projects')
            projectId = projects[0].id
          }
          const epic = await this.storage.createEpic(projectId, {
            title: params.title,
            description: params.description,
            status: params.status || 'draft',
            specId: params.spec_id,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, epic: { id: epic.id, title: epic.title, status: epic.status } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_show',
      'Get epic details with tickets',
      { id: z.string().describe('Epic ID') },
      async (params) => {
        try {
          const epic = await this.storage.getEpic(params.id)
          if (!epic) throw new Error(`Epic not found: ${params.id}`)
          const tickets = await this.storage.getTicketsForEpic(epic.projectId, params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                epic: {
                  ...epic,
                  ticketCount: tickets.length,
                  tickets: tickets.map((t: Ticket) => ({ id: t.id, title: t.title, statusName: t.statusName, priority: t.priority })),
                  createdAt: epic.createdAt.toISOString(),
                  updatedAt: epic.updatedAt.toISOString(),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_update',
      'Update an epic',
      {
        id: z.string().describe('Epic ID'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['active', 'draft', 'complete', 'dropped', 'future']).optional(),
      },
      async (params) => {
        try {
          const changes: Partial<Epic> = {}
          if (params.title) changes.title = params.title
          if (params.description !== undefined) changes.description = params.description
          if (params.status) changes.status = params.status
          const epic = await this.storage.updateEpic(params.id, changes)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, epic: { id: epic.id, title: epic.title, status: epic.status } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_delete',
      'Delete an epic',
      { id: z.string().describe('Epic ID') },
      async (params) => {
        try {
          await this.storage.deleteEpic(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `Deleted epic ${params.id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_reorder',
      'Reorder an epic',
      {
        id: z.string().describe('Epic ID'),
        position: z.number().describe('New position'),
        project: z.string().optional(),
      },
      async (params) => {
        try {
          const epic = await this.storage.getEpic(params.id)
          if (!epic) throw new Error(`Epic not found: ${params.id}`)
          const reordered = await this.storage.reorderEpic(params.project || epic.projectId, params.id, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, epic: { id: reordered.id, position: reordered.position } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'epic_add_blocker',
      'Add epic dependency',
      {
        epic_id: z.string().describe('Epic that will be blocked'),
        blocker_id: z.string().describe('Epic that blocks'),
      },
      async (params) => {
        try {
          await this.storage.createEpicDependency(params.epic_id, params.blocker_id, 'blocks')
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Epic dependency added' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // WORK TOOLS (Agent workflow)
  // ===========================================================================

  private registerWorkTools(server: McpServer): void {
    server.tool(
      'work_status',
      'Get current work status (in-progress tickets)',
      {},
      async () => {
        try {
          const tickets = await this.storage.listTickets(undefined, { allProjects: true })
          const inProgress = tickets.filter((t: Ticket) => t.statusCategory === 'started' && t.assignee)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                inProgressCount: inProgress.length,
                tickets: inProgress.map((t: Ticket) => ({
                  id: t.id,
                  title: t.title,
                  assignee: t.assignee,
                  statusName: t.statusName,
                  priority: t.priority,
                  projectId: t.projectId,
                  branch: t.branch,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'work_start',
      'Start working on a ticket (moves to In Progress)',
      {
        ticket_id: z.string().describe('Ticket ID'),
        assignee: z.string().optional().describe('Who is working'),
      },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
          if (params.assignee) {
            await this.storage.updateTicket(params.ticket_id, { assignee: params.assignee })
          }
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const progressCol = columns.find((c: string) =>
            c.toLowerCase().includes('progress') || c.toLowerCase().includes('doing')
          ) || columns[Math.min(1, columns.length - 1)]
          const moved = await this.storage.moveTicket(ticket.projectId!, params.ticket_id, progressCol)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: this.formatTicket(moved),
                message: `Started ${moved.id}: ${moved.title}`,
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'work_complete',
      'Mark ticket complete (moves to Done)',
      { ticket_id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const doneCol = columns.find((c: string) =>
            c.toLowerCase().includes('done') || c.toLowerCase().includes('complete')
          ) || columns[columns.length - 1]
          const moved = await this.storage.moveTicket(ticket.projectId!, params.ticket_id, doneCol)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                ticket: this.formatTicket(moved),
                message: `Completed ${moved.id}`,
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'work_ready',
      'Mark ticket ready for review',
      { ticket_id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const reviewCol = columns.find((c: string) => c.toLowerCase().includes('review'))
          if (reviewCol) {
            const moved = await this.storage.moveTicket(ticket.projectId!, params.ticket_id, reviewCol)
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: true, ticket: this.formatTicket(moved), message: `${moved.id} ready for review` }, null, 2),
              }],
            }
          }
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'No review column found', ticket: this.formatTicket(ticket) }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'work_revise',
      'Send ticket back for revision',
      { ticket_id: z.string().describe('Ticket ID') },
      async (params) => {
        try {
          const ticket = await this.storage.getTicket(params.ticket_id)
          if (!ticket) throw new Error(`Ticket not found: ${params.ticket_id}`)
          const columns = this.storage.getColumnNames(ticket.projectId!)
          const progressCol = columns.find((c: string) => c.toLowerCase().includes('progress')) || columns[1]
          const moved = await this.storage.moveTicket(ticket.projectId!, params.ticket_id, progressCol)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, ticket: this.formatTicket(moved), message: `${moved.id} sent back for revision` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // WORKFLOW TOOLS
  // ===========================================================================

  private registerWorkflowTools(server: McpServer): void {
    server.tool(
      'workflow_list',
      'List all workflows',
      { include_builtin: z.boolean().optional() },
      async (params) => {
        try {
          const workflows = await this.storage.listWorkflows({
            isBuiltin: params.include_builtin ? undefined : false,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                workflows: workflows.map((w: Workflow) => ({
                  id: w.id,
                  name: w.name,
                  description: w.description,
                  isBuiltin: w.isBuiltin,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'workflow_show',
      'Get workflow details with statuses',
      { id: z.string().describe('Workflow ID') },
      async (params) => {
        try {
          const workflow = await this.storage.getWorkflow(params.id)
          if (!workflow) throw new Error(`Workflow not found: ${params.id}`)
          const statuses = await this.storage.listStatuses(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                workflow: {
                  ...workflow,
                  statuses: statuses.map((s: WorkflowStatus) => ({
                    id: s.id,
                    name: s.name,
                    category: s.category,
                    position: s.position,
                    isDefault: s.isDefault,
                  })),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'workflow_create',
      'Create a new workflow',
      {
        name: z.string().describe('Workflow name'),
        description: z.string().optional(),
        statuses: z.array(z.string()).optional().describe('Status names'),
      },
      async (params) => {
        try {
          const workflow = await this.storage.createWorkflow({
            name: params.name,
            description: params.description,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, workflow: { id: workflow.id, name: workflow.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'workflow_delete',
      'Delete a workflow',
      { id: z.string().describe('Workflow ID') },
      async (params) => {
        try {
          await this.storage.deleteWorkflow(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: `Deleted workflow ${params.id}` }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // STATUS TOOLS
  // ===========================================================================

  private registerStatusTools(server: McpServer): void {
    server.tool(
      'status_list',
      'List statuses in a workflow',
      { workflow_id: z.string().describe('Workflow ID') },
      async (params) => {
        try {
          const statuses = await this.storage.listStatuses(params.workflow_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                statuses: statuses.map((s: WorkflowStatus) => ({
                  id: s.id,
                  name: s.name,
                  category: s.category,
                  position: s.position,
                  isDefault: s.isDefault,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'status_create',
      'Create a status in a workflow',
      {
        workflow_id: z.string().describe('Workflow ID'),
        name: z.string().describe('Status name'),
        category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).describe('Category'),
        position: z.number().optional(),
        is_default: z.boolean().optional(),
      },
      async (params) => {
        try {
          const status = await this.storage.createStatus(params.workflow_id, {
            name: params.name,
            category: params.category,
            position: params.position,
            isDefault: params.is_default,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, status: { id: status.id, name: status.name, category: status.category } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'status_update',
      'Update a status',
      {
        id: z.string().describe('Status ID'),
        name: z.string().optional(),
        category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
      },
      async (params) => {
        try {
          const changes: Partial<WorkflowStatus> = {}
          if (params.name) changes.name = params.name
          if (params.category) changes.category = params.category
          const status = await this.storage.updateStatus(params.id, changes)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, status: { id: status.id, name: status.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'status_reorder',
      'Reorder a status',
      {
        id: z.string().describe('Status ID'),
        position: z.number().describe('New position'),
      },
      async (params) => {
        try {
          const status = await this.storage.reorderStatus(params.id, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, status: { id: status.id, position: status.position } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'status_delete',
      'Delete a status',
      { id: z.string().describe('Status ID') },
      async (params) => {
        try {
          await this.storage.deleteStatus(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Status deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // PHASE TOOLS
  // ===========================================================================

  private registerPhaseTools(server: McpServer): void {
    server.tool(
      'phase_list',
      'List project phases',
      { category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional() },
      async (params) => {
        try {
          const phases = await this.storage.listPhases({ category: params.category })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                phases: phases.map((p: ProjectPhase) => ({
                  id: p.id,
                  name: p.name,
                  category: p.category,
                  position: p.position,
                  isDefault: p.isDefault,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'phase_create',
      'Create a project phase',
      {
        name: z.string().describe('Phase name'),
        category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']),
        position: z.number().optional(),
        is_default: z.boolean().optional(),
      },
      async (params) => {
        try {
          const phase = await this.storage.createPhase({
            name: params.name,
            category: params.category,
            position: params.position,
            isDefault: params.is_default,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, phase: { id: phase.id, name: phase.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'phase_update',
      'Update a phase',
      {
        id: z.string().describe('Phase ID'),
        name: z.string().optional(),
        category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
      },
      async (params) => {
        try {
          const changes: Partial<ProjectPhase> = {}
          if (params.name) changes.name = params.name
          if (params.category) changes.category = params.category
          const phase = await this.storage.updatePhase(params.id, changes)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, phase: { id: phase.id, name: phase.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'phase_delete',
      'Delete a phase',
      { id: z.string().describe('Phase ID') },
      async (params) => {
        try {
          await this.storage.deletePhase(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Phase deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'phase_template_list',
      'List phase templates',
      {},
      async () => {
        try {
          const templates = await this.storage.listPhaseTemplates()
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                templates: templates.map((t: PhaseTemplate) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  isBuiltin: t.isBuiltin,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'phase_template_apply',
      'Apply a phase template',
      { template_id: z.string().describe('Template ID') },
      async (params) => {
        try {
          const phases = await this.storage.applyPhaseTemplate(params.template_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                message: `Applied template, created ${phases.length} phases`,
                phases: phases.map((p: ProjectPhase) => ({ id: p.id, name: p.name })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // ACTION TOOLS
  // ===========================================================================

  private registerActionTools(server: McpServer): void {
    server.tool(
      'action_list',
      'List work actions',
      { include_builtin: z.boolean().optional() },
      async (params) => {
        try {
          const actions = await this.storage.listActions({
            isBuiltin: params.include_builtin ? undefined : false,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                actions: actions.map((a: WorkAction) => ({
                  id: a.id,
                  name: a.name,
                  description: a.description,
                  modifiesCode: a.modifiesCode,
                  isBuiltin: a.isBuiltin,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'action_show',
      'Get action details',
      { id: z.string().describe('Action ID') },
      async (params) => {
        try {
          const action = await this.storage.getAction(params.id)
          if (!action) throw new Error(`Action not found: ${params.id}`)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, action }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'action_create',
      'Create a work action',
      {
        name: z.string().describe('Action name'),
        prompt: z.string().describe('Start prompt'),
        description: z.string().optional(),
        end_prompt: z.string().optional(),
        modifies_code: z.boolean().optional(),
      },
      async (params) => {
        try {
          const action = await this.storage.createAction({
            name: params.name,
            prompt: params.prompt,
            description: params.description,
            endPrompt: params.end_prompt,
            modifiesCode: params.modifies_code ?? true,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, action: { id: action.id, name: action.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'action_delete',
      'Delete an action',
      { id: z.string().describe('Action ID') },
      async (params) => {
        try {
          await this.storage.deleteAction(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Action deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // ROADMAP TOOLS
  // ===========================================================================

  private registerRoadmapTools(server: McpServer): void {
    server.tool(
      'roadmap_list',
      'List roadmaps',
      {},
      async () => {
        try {
          const roadmaps = await this.storage.listRoadmaps()
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                roadmaps: roadmaps.map((r: Roadmap) => ({
                  id: r.id,
                  name: r.name,
                  description: r.description,
                  isDefault: r.isDefault,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'roadmap_create',
      'Create a roadmap',
      {
        name: z.string().describe('Roadmap name'),
        description: z.string().optional(),
        is_default: z.boolean().optional(),
      },
      async (params) => {
        try {
          const roadmap = await this.storage.createRoadmap({
            name: params.name,
            description: params.description,
            isDefault: params.is_default ?? false,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, roadmap: { id: roadmap.id, name: roadmap.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'roadmap_show',
      'Get roadmap with projects',
      { id: z.string().describe('Roadmap ID') },
      async (params) => {
        try {
          const roadmap = await this.storage.getRoadmap(params.id)
          if (!roadmap) throw new Error(`Roadmap not found: ${params.id}`)
          const projects = await this.storage.listRoadmapProjects(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                roadmap: {
                  ...roadmap,
                  projects: projects.map((p: Project) => ({ id: p.id, name: p.name })),
                },
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'roadmap_add_project',
      'Add project to roadmap',
      {
        roadmap_id: z.string().describe('Roadmap ID'),
        project_id: z.string().describe('Project ID'),
        position: z.number().optional(),
      },
      async (params) => {
        try {
          await this.storage.addProjectToRoadmap(params.roadmap_id, params.project_id, params.position)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Project added to roadmap' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'roadmap_remove_project',
      'Remove project from roadmap',
      {
        roadmap_id: z.string().describe('Roadmap ID'),
        project_id: z.string().describe('Project ID'),
      },
      async (params) => {
        try {
          await this.storage.removeProjectFromRoadmap(params.roadmap_id, params.project_id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Project removed from roadmap' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'roadmap_delete',
      'Delete a roadmap',
      { id: z.string().describe('Roadmap ID') },
      async (params) => {
        try {
          await this.storage.deleteRoadmap(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Roadmap deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // CATEGORY TOOLS
  // ===========================================================================

  private registerCategoryTools(server: McpServer): void {
    server.tool(
      'category_list',
      'List categories',
      { type: z.enum(['ticket', 'status']).optional() },
      async (params) => {
        try {
          const categories = await this.storage.listCategories({ type: params.type })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                categories: categories.map((c: Category) => ({
                  id: c.id,
                  name: c.name,
                  type: c.type,
                  isBuiltin: c.isBuiltin,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'category_create',
      'Create a category',
      {
        name: z.string().describe('Category name'),
        type: z.enum(['ticket', 'status']).describe('Category type'),
        description: z.string().optional(),
        color: z.string().optional(),
      },
      async (params) => {
        try {
          const category = await this.storage.createCategory({
            name: params.name,
            type: params.type,
            description: params.description,
            color: params.color,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, category: { id: category.id, name: category.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'category_rename',
      'Rename a category',
      {
        id: z.string().describe('Category ID'),
        name: z.string().describe('New name'),
      },
      async (params) => {
        try {
          const category = await this.storage.renameCategory(params.id, params.name)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, category: { id: category.id, name: category.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'category_delete',
      'Delete a category',
      { id: z.string().describe('Category ID') },
      async (params) => {
        try {
          await this.storage.deleteCategory(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Category deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // TEMPLATE TOOLS
  // ===========================================================================

  private registerTemplateTools(server: McpServer): void {
    server.tool(
      'ticket_template_list',
      'List ticket templates',
      { include_builtin: z.boolean().optional() },
      async (params) => {
        try {
          const templates = await this.storage.listTicketTemplates({
            isBuiltin: params.include_builtin ? undefined : false,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                templates: templates.map((t: TicketTemplate) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  isBuiltin: t.isBuiltin,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_template_show',
      'Get ticket template details',
      { id: z.string().describe('Template ID') },
      async (params) => {
        try {
          const template = await this.storage.getTicketTemplate(params.id)
          if (!template) throw new Error(`Template not found: ${params.id}`)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, template }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_template_create',
      'Create a ticket template',
      {
        name: z.string().describe('Template name'),
        description: z.string().optional(),
        title_pattern: z.string().optional(),
        description_template: z.string().optional(),
        default_priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
        default_category: z.string().optional(),
      },
      async (params) => {
        try {
          const template = await this.storage.createTicketTemplate({
            name: params.name,
            description: params.description,
            titlePattern: params.title_pattern,
            descriptionTemplate: params.description_template,
            defaultPriority: params.default_priority,
            defaultCategory: params.default_category,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, template: { id: template.id, name: template.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_template_create_from_ticket',
      'Create template from existing ticket',
      {
        ticket_id: z.string().describe('Ticket ID'),
        name: z.string().describe('Template name'),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const template = await this.storage.createTicketTemplateFromTicket(
            params.ticket_id,
            params.name,
            params.description
          )
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, template: { id: template.id, name: template.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'ticket_template_delete',
      'Delete a ticket template',
      { id: z.string().describe('Template ID') },
      async (params) => {
        try {
          await this.storage.deleteTicketTemplate(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'Template deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // VIEW TOOLS
  // ===========================================================================

  private registerViewTools(server: McpServer): void {
    server.tool(
      'view_list',
      'List board views for a project',
      { project: z.string().optional() },
      async (params) => {
        try {
          const views = await this.storage.listBoardViews({ projectId: params.project })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                views: views.map((v: BoardView) => ({
                  id: v.id,
                  name: v.name,
                  description: v.description,
                  projectId: v.projectId,
                  isDefault: v.isDefault,
                })),
              }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'view_create',
      'Create a board view',
      {
        project: z.string().describe('Project ID'),
        name: z.string().describe('View name'),
        description: z.string().optional(),
        filters: z.object({
          assignee: z.string().optional(),
          owner: z.string().optional(),
          priority: z.string().optional(),
          epicId: z.string().optional(),
          search: z.string().optional(),
        }).optional(),
        is_default: z.boolean().optional(),
      },
      async (params) => {
        try {
          const view = await this.storage.createBoardView({
            projectId: params.project,
            name: params.name,
            description: params.description,
            filters: params.filters || {},
            isDefault: params.is_default,
          })
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, view: { id: view.id, name: view.name } }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'view_delete',
      'Delete a board view',
      { id: z.string().describe('View ID') },
      async (params) => {
        try {
          await this.storage.deleteBoardView(params.id)
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ success: true, message: 'View deleted' }, null, 2),
            }],
          }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // AGENT TOOLS (CLI passthrough)
  // ===========================================================================

  private registerAgentTools(server: McpServer): void {
    server.tool(
      'agent_list',
      'List all agents',
      { type: z.enum(['staff', 'temp', 'all']).optional() },
      async (params) => {
        try {
          const typeFlag = params.type ? `--type ${params.type}` : ''
          const output = this.runCommand(`prlt agent list ${typeFlag} --json 2>/dev/null || prlt agent list ${typeFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'agent_status',
      'Check agent status',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt agent status --json 2>/dev/null || prlt agent status')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'agent_add',
      'Add new agents',
      {
        names: z.array(z.string()).optional().describe('Agent names'),
        theme: z.string().optional().describe('Theme for names'),
        clone: z.boolean().optional().describe('Use git clone instead of worktree'),
      },
      async (params) => {
        try {
          const namesArg = params.names?.join(' ') || ''
          const themeFlag = params.theme ? `--theme ${params.theme}` : ''
          const cloneFlag = params.clone ? '--clone' : ''
          const output = this.runCommand(`prlt agent staff add ${namesArg} ${themeFlag} ${cloneFlag} --json`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'agent_remove',
      'Remove an agent',
      { name: z.string().describe('Agent name') },
      async (params) => {
        try {
          const output = this.runCommand(`prlt agent remove ${params.name} --json`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // DOCKER TOOLS (CLI passthrough)
  // ===========================================================================

  private registerDockerTools(server: McpServer): void {
    server.tool(
      'docker_status',
      'Check Docker daemon status',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt docker status')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'docker_list',
      'List Docker containers',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt docker list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'docker_start',
      'Start Docker containers',
      { agent: z.string().optional().describe('Agent name') },
      async (params) => {
        try {
          const agentArg = params.agent || ''
          const output = this.runCommand(`prlt docker start ${agentArg}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'docker_stop',
      'Stop Docker containers',
      { agent: z.string().optional().describe('Agent name') },
      async (params) => {
        try {
          const agentArg = params.agent || ''
          const output = this.runCommand(`prlt docker stop ${agentArg}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'docker_logs',
      'Get container logs',
      {
        agent: z.string().describe('Agent name'),
        lines: z.number().optional().describe('Number of lines'),
      },
      async (params) => {
        try {
          const linesFlag = params.lines ? `-n ${params.lines}` : ''
          const output = this.runCommand(`prlt docker logs ${params.agent} ${linesFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // REPO TOOLS (CLI passthrough)
  // ===========================================================================

  private registerRepoTools(server: McpServer): void {
    server.tool(
      'repo_list',
      'List repositories in workspace',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt repo list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'repo_add',
      'Add a repository',
      {
        path: z.string().describe('Repository path or URL'),
        name: z.string().optional().describe('Name for the repo'),
      },
      async (params) => {
        try {
          const nameFlag = params.name ? `--name ${params.name}` : ''
          const output = this.runCommand(`prlt repo add ${params.path} ${nameFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'repo_remove',
      'Remove a repository',
      { name: z.string().describe('Repository name') },
      async (params) => {
        try {
          const output = this.runCommand(`prlt repo remove ${params.name}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // BRANCH TOOLS (CLI passthrough)
  // ===========================================================================

  private registerBranchTools(server: McpServer): void {
    server.tool(
      'branch_list',
      'List branches',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt branch list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'branch_create',
      'Create a branch for a ticket',
      {
        ticket_id: z.string().describe('Ticket ID'),
        name: z.string().optional().describe('Branch name override'),
      },
      async (params) => {
        try {
          const nameFlag = params.name ? `--name ${params.name}` : ''
          const output = this.runCommand(`prlt branch create ${params.ticket_id} ${nameFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'branch_where',
      'Show which ticket/branch you are on',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt branch where')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // GITHUB TOOLS (CLI passthrough)
  // ===========================================================================

  private registerGitHubTools(server: McpServer): void {
    server.tool(
      'gh_status',
      'Check GitHub CLI status',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt gh status')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'gh_login',
      'Login to GitHub',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt gh login')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'pr_create',
      'Create a pull request',
      {
        ticket_id: z.string().optional().describe('Ticket ID'),
        title: z.string().optional().describe('PR title'),
        body: z.string().optional().describe('PR body'),
        draft: z.boolean().optional().describe('Create as draft'),
      },
      async (params) => {
        try {
          const ticketArg = params.ticket_id || ''
          const titleFlag = params.title ? `--title "${params.title}"` : ''
          const bodyFlag = params.body ? `--body "${params.body}"` : ''
          const draftFlag = params.draft ? '--draft' : ''
          const output = this.runCommand(`prlt pr create ${ticketArg} ${titleFlag} ${bodyFlag} ${draftFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'pr_list',
      'List pull requests',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt pr list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'pr_status',
      'Check PR status',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt pr status')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // INIT TOOLS (CLI passthrough)
  // ===========================================================================

  private registerInitTools(server: McpServer): void {
    server.tool(
      'init',
      'Initialize an HQ workspace',
      {
        name: z.string().describe('HQ name'),
        path: z.string().optional().describe('HQ path'),
        repos: z.array(z.string()).optional().describe('Repository paths'),
        agents: z.array(z.string()).optional().describe('Agent names'),
        pmo: z.boolean().optional().describe('Include PMO'),
      },
      async (params) => {
        try {
          const pathFlag = params.path ? `--path ${params.path}` : ''
          const reposFlag = params.repos?.length ? `--repos ${params.repos.join(',')}` : ''
          const agentsFlag = params.agents?.length ? `--agents ${params.agents.join(',')}` : ''
          const pmoFlag = params.pmo === false ? '--no-pmo' : '--pmo'
          const output = this.runCommand(`prlt init --name ${params.name} ${pathFlag} ${reposFlag} ${agentsFlag} ${pmoFlag} --json`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'pmo_init',
      'Initialize PMO in existing workspace',
      {
        template: z.string().optional().describe('Board template'),
        name: z.string().optional().describe('Board name'),
      },
      async (params) => {
        try {
          const templateFlag = params.template ? `--template ${params.template}` : ''
          const nameFlag = params.name ? `--name ${params.name}` : ''
          const output = this.runCommand(`prlt pmo init ${templateFlag} ${nameFlag}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // UTILITY TOOLS
  // ===========================================================================

  private registerUtilityTools(server: McpServer): void {
    server.tool(
      'whoami',
      'Show current context (agent, workspace)',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt whoami')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'commit',
      'Create a commit with ticket reference',
      {
        message: z.string().describe('Commit message'),
        ticket_id: z.string().optional().describe('Ticket ID'),
      },
      async (params) => {
        try {
          const ticketArg = params.ticket_id || ''
          const output = this.runCommand(`prlt commit "${params.message}" ${ticketArg}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'execution_list',
      'List work executions',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt execution list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'execution_view',
      'View execution details',
      { id: z.string().describe('Execution ID') },
      async (params) => {
        try {
          const output = this.runCommand(`prlt execution view ${params.id}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'execution_logs',
      'Get execution logs',
      { id: z.string().describe('Execution ID') },
      async (params) => {
        try {
          const output = this.runCommand(`prlt execution logs ${params.id}`)
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'session_list',
      'List tmux sessions',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt session list')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )

    server.tool(
      'config_show',
      'Show configuration',
      {},
      async () => {
        try {
          const output = this.runCommand('prlt config')
          return { content: [{ type: 'text' as const, text: output }] }
        } catch (error) {
          return this.errorResponse(error)
        }
      }
    )
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private formatTicket(t: Ticket) {
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      category: t.category,
      statusName: t.statusName,
      statusCategory: t.statusCategory,
      projectId: t.projectId,
      assignee: t.assignee,
      owner: t.owner,
      branch: t.branch,
      epicId: t.epicId,
    }
  }

  private formatTicketFull(t: Ticket) {
    return {
      ...this.formatTicket(t),
      description: t.description,
      subtasks: t.subtasks,
      labels: t.labels,
      metadata: t.metadata,
      blockedBy: t.blockedBy,
      acceptanceCriteria: t.acceptanceCriteria,
      specId: t.specId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }
  }

  private errorResponse(error: unknown) {
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
