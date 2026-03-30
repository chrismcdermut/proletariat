/**
 * Sync Engine
 *
 * Orchestrates the reconciliation process: gathers ticket state and PR state,
 * runs the reconciler, and applies corrective actions through providers.
 *
 * This is the "run once" engine. The daemon wraps this with a polling loop.
 */

import type Database from 'better-sqlite3'
import type { Ticket } from '../pmo/types.js'
import type { TicketProvider, ProviderStorage } from '../providers/types.js'
import type { PMOStorage } from '../pmo/types.js'
import { resolveTicketProvider } from '../providers/resolver.js'
import { ExecutionStorage } from '../execution/storage.js'
import {
  getPRForBranch,
  getPRChecks,
  listOpenPRs,
  type PRInfo,
} from '../pr/index.js'
import { ExternalExecutionMappingStore } from '../external-issues/mapping-store.js'
import type { ExternalMappingProvider } from '../external-issues/types.js'
import {
  reconcileTicket,
  reconcileAgentSpawned,
  detectDuplicates,
  detectStaleTriage,
  type ReconcileAction,
  type ReconcileResult,
  type ReconcileContext,
} from './reconciler.js'

// =============================================================================
// Types
// =============================================================================

export interface SyncEngineOptions {
  /** Working directory for git/gh operations */
  cwd?: string
  /** Callback for logging */
  log?: (msg: string) => void
  /** If true, don't actually move tickets — just report what would happen */
  dryRun?: boolean
}

export interface SyncReport {
  result: ReconcileResult
  applied: ReconcileAction[]
  skipped: ReconcileAction[]
  failed: Array<{ action: ReconcileAction; error: string }>
}

// =============================================================================
// Engine
// =============================================================================

/**
 * Run a single reconciliation cycle.
 *
 * 1. List all tickets in started/review states
 * 2. For each, check PR status
 * 3. Run reconciler to determine actions
 * 4. Apply actions through providers
 */
export async function runSyncCycle(
  db: Database.Database,
  storage: PMOStorage & ProviderStorage,
  projectId: string,
  options: SyncEngineOptions = {},
): Promise<SyncReport> {
  const { cwd, log, dryRun } = options
  const execStorage = new ExecutionStorage(db)

  // Gather all tickets in active states (started = In Progress / In Review)
  const startedTickets = await storage.listTickets(projectId, { statusCategory: 'started' })
  // Also check recently completed tickets to catch any that were manually moved
  // but whose PR state doesn't match

  log?.(`Checking ${startedTickets.length} active ticket(s)...`)

  // Pre-fetch open PRs to reduce API calls
  const openPRs = listOpenPRs(cwd)
  const prByBranch = new Map<string, PRInfo>()
  for (const pr of openPRs) {
    prByBranch.set(pr.headBranch, pr)
  }

  const actions: ReconcileAction[] = []
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const ticket of startedTickets) {
    try {
      const ctx = buildContext(ticket, prByBranch, execStorage, cwd)
      const action = reconcileTicket(ctx)
      if (action) {
        actions.push(action)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ ticketId: ticket.id, error: msg })
    }
  }

  // Sync discovered PRs into pmo_external_execution_prs so work ship can find them
  try {
    const mappingStore = new ExternalExecutionMappingStore(db)
    for (const ticket of startedTickets) {
      if (!ticket.branch) continue
      const pr = prByBranch.get(ticket.branch) ?? null
      if (!pr) continue

      // Find external mappings that reference this ticket
      const mappingRows = db.prepare(`
        SELECT provider, external_id
        FROM pmo_external_execution_map
        WHERE latest_state_snapshot LIKE ? OR external_key = ?
      `).all(`%${ticket.id}%`, ticket.metadata?.external_key ?? '') as Array<{
        provider: ExternalMappingProvider
        external_id: string
      }>

      for (const row of mappingRows) {
        try {
          mappingStore.upsertMapping({
            provider: row.provider,
            externalId: row.external_id,
            prUrl: pr.url,
            lastSyncedAt: new Date(),
          })
        } catch {
          // Non-fatal — skip this mapping
        }
      }
    }
  } catch {
    // PR sync is non-fatal — don't break the reconciliation cycle
  }

  // Board-level reconciliation: agent spawned → In Progress
  const activeAgentTicketIds = new Set<string>()
  try {
    const runningAgents = db.prepare(`
      SELECT DISTINCT ticket_id FROM agent_work
      WHERE status IN ('starting', 'running')
    `).all() as Array<{ ticket_id: string }>
    for (const row of runningAgents) {
      activeAgentTicketIds.add(row.ticket_id)
    }
  } catch {
    // agent_work table may not exist — non-fatal
  }

  // Get all tickets for board-level rules (duplicates, stale triage, agent spawned)
  const allTickets = await storage.listTickets(projectId)
  const agentSpawnedActions = reconcileAgentSpawned(allTickets, activeAgentTicketIds)
  actions.push(...agentSpawnedActions)

  // Board-level: detect duplicate tickets
  const duplicateActions = detectDuplicates(allTickets)
  actions.push(...duplicateActions)

  // Board-level: detect stale triage tickets matching merged PRs
  const mergedBranches = new Set<string>()
  for (const ticket of allTickets) {
    if (!ticket.branch) continue
    const category = ticket.statusCategory
    if (category === 'backlog' || category === 'unstarted' || category === 'triage') {
      const pr = prByBranch.get(ticket.branch) ?? getPRForBranch(ticket.branch, cwd)
      if (pr?.state === 'MERGED') {
        mergedBranches.add(ticket.branch)
      }
    }
  }
  const staleTriageActions = detectStaleTriage(allTickets, mergedBranches)
  actions.push(...staleTriageActions)

  const result: ReconcileResult = {
    actions,
    checked: startedTickets.length + allTickets.length,
    errors,
  }

  // Apply actions
  const applied: ReconcileAction[] = []
  const skipped: ReconcileAction[] = []
  const failed: Array<{ action: ReconcileAction; error: string }> = []

  for (const action of actions) {
    if (dryRun) {
      skipped.push(action)
      log?.(`[dry-run] Would ${formatAction(action)}`)
      continue
    }

    if (action.type === 'flag_stale' || action.type === 'flag_stale_triage' || action.type === 'flag_duplicate') {
      // Flag actions are logged but not moved — they're informational
      log?.(`${action.type}: ${action.ticketId} — ${action.reason}`)
      applied.push(action)
      continue
    }

    try {
      const ticket = await storage.getTicket(action.ticketId)
      if (!ticket) {
        failed.push({ action, error: 'Ticket not found' })
        continue
      }

      const provider = resolveTicketProvider(
        action.ticketId,
        ticket.projectId ?? projectId,
        db,
        storage,
        ticket.metadata,
      )

      if (action.targetStatus) {
        const moveResult = await provider.moveTicket(action.ticketId, action.targetStatus)
        if (moveResult.success) {
          log?.(`Synced: ${action.ticketId} → ${action.targetStatus} (${action.reason})`)
          applied.push(action)

          // If moving to Done, also mark any running executions as completed
          if (action.type === 'move_to_done') {
            markExecutionsCompleted(execStorage, action.ticketId)
          }
        } else {
          failed.push({ action, error: moveResult.error ?? 'Move failed' })
          log?.(`Failed: ${action.ticketId} — ${moveResult.error}`)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ action, error: msg })
      log?.(`Error: ${action.ticketId} — ${msg}`)
    }
  }

  return { result, applied, skipped, failed }
}

// =============================================================================
// Helpers
// =============================================================================

function buildContext(
  ticket: Ticket,
  prByBranch: Map<string, PRInfo>,
  execStorage: ExecutionStorage,
  cwd?: string,
): ReconcileContext {
  // Look up PR by branch — try ticket.branch first, then external key patterns
  let pr: PRInfo | null = null
  let checks: import('../pr/index.js').PRCheck[] = []

  if (ticket.branch) {
    // First check the pre-fetched open PRs
    pr = prByBranch.get(ticket.branch) ?? null

    // If not found in open PRs, the PR might be merged/closed — fetch directly
    if (!pr) {
      pr = getPRForBranch(ticket.branch, cwd)
    }
  }

  if (pr && pr.state === 'OPEN') {
    checks = getPRChecks(pr.number, cwd)
  }

  // Check for active execution
  const hasActiveExecution = !!execStorage.getRunningExecution(ticket.id)

  return { ticket, pr, checks, hasActiveExecution }
}

function markExecutionsCompleted(execStorage: ExecutionStorage, ticketId: string): void {
  const running = execStorage.getRunningExecution(ticketId)
  if (running) {
    execStorage.updateStatus(running.id, 'completed')
  }
}

function formatAction(action: ReconcileAction): string {
  switch (action.type) {
    case 'move_to_done':
      return `move ${action.ticketId} to Done (${action.reason})`
    case 'move_to_review':
      return `move ${action.ticketId} to Review (${action.reason})`
    case 'move_to_in_progress':
      return `move ${action.ticketId} to In Progress (${action.reason})`
    case 'move_to_backlog':
      return `move ${action.ticketId} to Backlog (${action.reason})`
    case 'flag_stale':
      return `flag ${action.ticketId} as stale (${action.reason})`
    case 'flag_stale_triage':
      return `flag ${action.ticketId} as stale triage (${action.reason})`
    case 'flag_duplicate':
      return `flag ${action.ticketId} as duplicate (${action.reason})`
  }
}
