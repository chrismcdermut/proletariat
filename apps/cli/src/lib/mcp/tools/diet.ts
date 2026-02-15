/**
 * MCP Diet & Pull Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'
import {
  loadDietConfig,
  saveDietConfig,
  parseDietString,
  formatDietConfig,
  type DietConfig,
  type PulledTicket,
} from '../../pmo/diet.js'
import type { Ticket, WorkflowStatus } from '../../pmo/types.js'

export function registerDietTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'diet_show',
    'Show current diet configuration and distribution report',
    {
      project_id: z.string().optional().describe('Project ID (uses default if omitted)'),
    },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        const dietConfig = loadDietConfig(db)
        const projectId = params.project_id || (await getDefaultProjectId(ctx))

        const report = await buildDietReport(ctx, projectId, dietConfig)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              diet: formatDietConfig(dietConfig),
              ratios: dietConfig.ratios,
              report: {
                totalReady: report.totalReady,
                uncategorized: report.uncategorized,
                categories: report.categories,
              },
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'diet_set',
    'Set diet weights (relative values normalized to percentages automatically)',
    {
      ratios: z.string().describe('Diet weights as "category=weight,..." e.g. "ship=4,grow=2.5,support=1.5,bizops=1,strategy=1"'),
    },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        const newConfig = parseDietString(params.ratios)
        saveDietConfig(db, newConfig)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              diet: formatDietConfig(newConfig),
              ratios: newConfig.ratios,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'pull_tickets',
    'Pull tickets from Backlog to Ready with diet ratio enforcement',
    {
      project_id: z.string().optional().describe('Project ID (uses default if omitted)'),
      count: z.number().optional().describe('Number of tickets to pull (default 50)'),
      dry_run: z.boolean().optional().describe('If true, show what would be pulled without moving'),
    },
    async (params) => {
      try {
        const db = ctx.storage.getDatabase()
        const dietConfig = loadDietConfig(db)
        const projectId = params.project_id || (await getDefaultProjectId(ctx))
        const count = params.count || 50
        const dryRun = params.dry_run || false

        const result = await runPull(ctx, projectId, dietConfig, count, dryRun)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              dryRun,
              totalCandidates: result.totalCandidates,
              skippedBlocked: result.skippedBlocked,
              skippedCeiling: result.skippedCeiling,
              pulled: result.pulled.map(t => ({
                id: t.id,
                title: t.title,
                category: t.category,
                pass: t.pass,
              })),
              pulledCount: result.pulled.length,
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

// =============================================================================
// Helpers
// =============================================================================

async function getDefaultProjectId(ctx: McpToolContext): Promise<string> {
  const projects = await ctx.storage.listProjects()
  if (projects.length === 0) throw new Error('No projects found')
  return projects[0].id
}

interface DietCategoryReport {
  category: string
  target: number
  actual: number
  count: number
  targetCount: number
  delta: number
  status: 'over' | 'under' | 'ok'
}

interface DietReport {
  categories: DietCategoryReport[]
  totalReady: number
  uncategorized: number
}

async function buildDietReport(
  ctx: McpToolContext,
  projectId: string,
  dietConfig: DietConfig,
): Promise<DietReport> {
  const project = await ctx.storage.getProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const workflowId = project.workflowId || 'default'
  const statuses = await ctx.storage.listStatuses(workflowId)
  const readyStatuses = statuses.filter((s: WorkflowStatus) => s.category === 'unstarted')

  const readyTickets: Ticket[] = []
  for (const status of readyStatuses) {
    const tickets = await ctx.storage.listTickets(projectId, { statusId: status.id })
    readyTickets.push(...tickets)
  }

  const totalReady = readyTickets.length
  const categoryCounts = new Map<string, number>()
  let uncategorized = 0

  for (const ticket of readyTickets) {
    const cat = (ticket.category || '').toLowerCase()
    if (cat) {
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    } else {
      uncategorized++
    }
  }

  const categories: DietCategoryReport[] = dietConfig.ratios.map(ratio => {
    const count = categoryCounts.get(ratio.category) || 0
    const actual = totalReady > 0 ? count / totalReady : 0
    const targetCount = Math.round(totalReady * ratio.target)
    const delta = actual - ratio.target
    const tolerance = 0.05

    let status: 'over' | 'under' | 'ok' = 'ok'
    if (delta > tolerance) status = 'over'
    else if (delta < -tolerance) status = 'under'

    return { category: ratio.category, target: ratio.target, actual, count, targetCount, delta, status }
  })

  return { categories, totalReady, uncategorized }
}

interface PullResult {
  pulled: PulledTicket[]
  skippedBlocked: number
  skippedCeiling: number
  totalCandidates: number
}

async function runPull(
  ctx: McpToolContext,
  projectId: string,
  dietConfig: DietConfig,
  targetCount: number,
  dryRun: boolean,
): Promise<PullResult> {
  const project = await ctx.storage.getProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const workflowId = project.workflowId || 'default'
  const statuses = await ctx.storage.listStatuses(workflowId)

  const backlogStatuses = statuses.filter((s: WorkflowStatus) => s.category === 'backlog')
  const readyStatuses = statuses.filter((s: WorkflowStatus) => s.category === 'unstarted')

  if (backlogStatuses.length === 0) throw new Error('No backlog statuses found')
  if (readyStatuses.length === 0) throw new Error('No ready/unstarted statuses found')

  const targetStatus = readyStatuses.sort((a: WorkflowStatus, b: WorkflowStatus) => a.position - b.position)[0]

  // Get backlog tickets sorted by position
  const backlogTickets: Ticket[] = []
  for (const status of backlogStatuses) {
    const tickets = await ctx.storage.listTickets(projectId, { statusId: status.id })
    backlogTickets.push(...tickets)
  }
  backlogTickets.sort((a, b) => (a.position || 0) - (b.position || 0))

  // Get existing ready tickets
  const existingReady: Ticket[] = []
  for (const status of readyStatuses) {
    const tickets = await ctx.storage.listTickets(projectId, { statusId: status.id })
    existingReady.push(...tickets)
  }

  // Pull algorithm
  const pulled: PulledTicket[] = []
  let skippedBlocked = 0
  let skippedCeiling = 0

  const categoryCounts = new Map<string, number>()
  for (const ratio of dietConfig.ratios) {
    categoryCounts.set(ratio.category, 0)
  }
  for (const ticket of existingReady) {
    const cat = (ticket.category || '').toLowerCase()
    if (cat) categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
  }

  const pulledIds = new Set<string>()
  const totalTarget = existingReady.length + targetCount

  const getCeiling = (category: string): number => {
    const ratio = dietConfig.ratios.find(r => r.category === category)
    if (!ratio) return targetCount
    return Math.ceil(totalTarget * ratio.target)
  }

  // Pass 1
  const remainingBacklog: Ticket[] = []
  for (const ticket of backlogTickets) {
    if (pulled.length >= targetCount) break

    const blocked = await ctx.storage.isTicketBlocked(ticket.id)
    if (blocked) {
      skippedBlocked++
      continue
    }

    const cat = (ticket.category || '').toLowerCase()
    const currentCount = categoryCounts.get(cat) || 0
    const ceiling = getCeiling(cat)

    if (currentCount < ceiling) {
      pulled.push({
        id: ticket.id,
        title: ticket.title,
        category: ticket.category || undefined,
        position: ticket.position || 0,
        pass: 'first',
      })
      pulledIds.add(ticket.id)
      categoryCounts.set(cat, currentCount + 1)
    } else {
      skippedCeiling++
      remainingBacklog.push(ticket)
    }
  }

  // Pass 2
  if (pulled.length < targetCount) {
    for (const ratio of dietConfig.ratios) {
      if (pulled.length >= targetCount) break

      const currentCount = categoryCounts.get(ratio.category) || 0
      const targetForCat = Math.ceil(totalTarget * ratio.target)

      if (currentCount < targetForCat) {
        const catTickets = remainingBacklog.filter(
          t => (t.category || '').toLowerCase() === ratio.category && !pulledIds.has(t.id)
        )

        for (const ticket of catTickets) {
          if (pulled.length >= targetCount) break
          if ((categoryCounts.get(ratio.category) || 0) >= targetForCat) break

          const blocked = await ctx.storage.isTicketBlocked(ticket.id)
          if (blocked) continue

          pulled.push({
            id: ticket.id,
            title: ticket.title,
            category: ticket.category || undefined,
            position: ticket.position || 0,
            pass: 'second',
          })
          pulledIds.add(ticket.id)
          categoryCounts.set(ratio.category, (categoryCounts.get(ratio.category) || 0) + 1)
        }
      }
    }
  }

  // Move tickets if not dry run
  if (!dryRun) {
    for (const ticket of pulled) {
      await ctx.storage.moveTicket(projectId, ticket.id, targetStatus.name)
    }
  }

  return {
    pulled,
    skippedBlocked,
    skippedCeiling,
    totalCandidates: backlogTickets.length,
  }
}
