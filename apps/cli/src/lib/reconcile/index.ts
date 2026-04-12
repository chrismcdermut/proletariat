/**
 * Tier 2 State Reconciler — Runner (PRLT-1280)
 *
 * This module owns the IO: it talks to the database, the GitHub CLI, and
 * the provider adapter layer. The pure rule logic lives in ./core.ts so
 * it can be unit-tested without these dependencies.
 *
 * Scope (narrow — the ticket is very explicit about what this is NOT):
 *   - Single idempotent reconciliation function on a schedule
 *   - Provider-agnostic — the reconciler does not branch on provider type
 *   - Fires normal state-transition code path so hooks & cleanup fire too
 *
 * Everything outside that — webhook listeners, LLM escalation, human
 * inbox, supervision tree — is explicitly out of scope per PRLT-1280.
 */

import type { SqliteDatabase } from '../database/sqlite.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { StateCategory, Ticket, PMOStorage } from '../pmo/types.js'
import type { ProviderStorage, TicketProvider } from '../providers/types.js'
import { resolveTicketProvider } from '../providers/resolver.js'
import type { PRInfo } from '../pr/index.js'
import { getPRForBranch, getPRByNumber } from '../pr/index.js'
import { getWorkflowConfig, type WorkflowConfig } from '../work-lifecycle/settings.js'
import { buildTransition, deriveExpectedState, formatTransitionLogLine } from './core.js'
import type {
  LinkedPR,
  PRLookupFn,
  ReconcileOptions,
  ReconcileReport,
  ReconcileTicket,
  ReconcileTransition,
} from './types.js'

export type {
  LinkedPR,
  LinkedPRSource,
  PRLookupFn,
  PRLookupRef,
  ReconcileOptions,
  ReconcileReport,
  ReconcileTicket,
  ReconcileTransition,
} from './types.js'
export { deriveExpectedState, buildTransition, formatTransitionLogLine } from './core.js'

/**
 * Non-terminal state categories that the reconciler scans.
 *
 * The ticket spec says:
 *   "Query all tickets in non-terminal states across all connected
 *    providers (Linear, PMO, Notion, Asana, Jira, Shortcut)"
 *
 * Terminal states (`completed`, `canceled`) are deliberately excluded —
 * the reconciler never resurrects a closed ticket.
 */
const NON_TERMINAL_CATEGORIES: StateCategory[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
]

/**
 * Default live PR lookup. Always goes to the remote — the Tier 2
 * reconciler must not depend on any local PR cache.
 */
export const defaultPRLookup: PRLookupFn = (ref, cwd) => {
  switch (ref.kind) {
    case 'branch':
      return getPRForBranch(ref.branch, cwd)
    case 'number':
      return getPRByNumber(ref.number, cwd)
    case 'url': {
      // `gh pr view <url>` works with either a number or URL; reuse it.
      const num = parsePRNumberFromUrl(ref.url)
      if (num !== null) return getPRByNumber(num, cwd)
      return null
    }
  }
}

/**
 * Run one reconciliation cycle.
 *
 * Strictly idempotent: if a ticket is already in its expected state the
 * runner computes no transition and touches nothing. Running twice
 * back-to-back produces no redundant side effects.
 */
export async function runReconcile(
  db: SqliteDatabase,
  storage: PMOStorage & ProviderStorage,
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const startedAt = new Date()
  const { dryRun = false, cwd, log, projectId } = options
  const prLookup = options.prLookup ?? defaultPRLookup

  // Workflow config is used to resolve "Done" / "In Progress" / "Review"
  // column names for the ticket's board. Fall back gracefully if the
  // settings table is missing (older databases, unit tests).
  let workflowConfig: WorkflowConfig | undefined
  try {
    workflowConfig = getWorkflowConfig(db)
  } catch {
    workflowConfig = undefined
  }

  // Gather every non-terminal ticket in scope. Either one project if
  // -P was passed, or every project in the workspace.
  const projectIds = projectId ? [projectId] : await listAllProjectIds(storage)

  const tickets: Ticket[] = []
  for (const pid of projectIds) {
    for (const category of NON_TERMINAL_CATEGORIES) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential is fine; small N
        const batch = await storage.listTickets(pid, { statusCategory: category })
        tickets.push(...batch)
      } catch {
        // Tolerate transient read errors on a single category; keep going.
      }
    }
  }

  log?.(`Scanning ${tickets.length} non-terminal ticket(s) across ${projectIds.length} project(s)...`)

  const transitions: ReconcileTransition[] = []
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const ticket of tickets) {
    try {
      const linkedPRs = gatherLinkedPRs(db, ticket, prLookup, cwd)
      if (linkedPRs.length === 0) {
        continue
      }

      // Resolve the provider for this ticket so we can log which backend
      // owns it. The actual move happens through the same resolver later
      // in applyTransition() — this is just for the transition record.
      const providerName = providerNameFor(db, storage, ticket)

      const decision = deriveExpectedState(toReconcileTicket(ticket), linkedPRs, workflowConfig)
      if (!decision) continue

      transitions.push(
        buildTransition({
          ticket: toReconcileTicket(ticket),
          provider: providerName,
          targetState: decision.targetState,
          reason: decision.reason,
          driver: decision.driver,
        }),
      )
    } catch (err) {
      errors.push({ ticketId: ticket.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Apply (or dry-run) every transition. Failures on one ticket do not
  // stop the others — the reconciler is a best-effort safety net.
  const applied: ReconcileTransition[] = []
  const skipped: ReconcileTransition[] = []
  const failed: Array<{ transition: ReconcileTransition; error: string }> = []

  for (const transition of transitions) {
    log?.(formatTransitionLogLine(transition))

    if (dryRun) {
      skipped.push(transition)
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await applyTransition(db, storage, transition)
      applied.push(transition)

      // Dual-identity tickets: if the primary provider is NOT local PMO,
      // the local PMO board may still hold a stale mirror row. Nudge it
      // to the same column so the local kanban view does not drift.
      if (transition.provider !== 'pmo') {
        // eslint-disable-next-line no-await-in-loop
        await reconcilePmoMirror(db, storage, transition, log)
      }
    } catch (err) {
      failed.push({
        transition,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const finishedAt = new Date()

  return {
    checked: tickets.length,
    applied,
    skipped,
    failed,
    errors,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  }
}

// -----------------------------------------------------------------------------
// PR lookup
// -----------------------------------------------------------------------------

/**
 * Gather every PR linked to a ticket by:
 *   1. the ticket's branch (if set), and
 *   2. PR URLs stored in `pmo_external_execution_prs` under any of the
 *      ticket's external-source identities.
 *
 * Every lookup goes through the live PR lookup function — no cache.
 */
function gatherLinkedPRs(
  db: SqliteDatabase,
  ticket: Ticket,
  prLookup: PRLookupFn,
  cwd?: string,
): LinkedPR[] {
  const results: LinkedPR[] = []
  const seen = new Set<number>() // de-dupe by PR number

  const push = (pr: PRInfo | null, source: LinkedPR['source']): void => {
    if (!pr) return
    if (seen.has(pr.number)) return
    seen.add(pr.number)
    results.push({ pr, source })
  }

  // 1. Ticket branch
  if (ticket.branch) {
    push(prLookup({ kind: 'branch', branch: ticket.branch }, cwd), 'ticket_branch')
  }

  // 2. PR URLs stored in the external execution map for this ticket.
  //    A ticket can carry multiple external identities (metadata.external_id,
  //    external_key) and can have been linked to multiple PRs over time.
  const prUrls = listLinkedPrUrls(db, ticket)
  for (const url of prUrls) {
    push(prLookup({ kind: 'url', url }, cwd), 'external_map')
  }

  return results
}

/**
 * Read every PR URL stored for this ticket in `pmo_external_execution_prs`.
 * Keyed by (provider, external_id) — the reconciler doesn't care which
 * provider it came from, so we union across all of them.
 */
function listLinkedPrUrls(db: SqliteDatabase, ticket: Ticket): string[] {
  const urls = new Set<string>()
  const md = ticket.metadata ?? {}

  // Collect every identifier that might key the external mapping table.
  const externalIds = new Set<string>()
  if (md.external_id) externalIds.add(md.external_id)
  if (md.external_key) externalIds.add(md.external_key)
  // A PMO-native ticket's id can also appear in the map under provider='pmo'.
  externalIds.add(ticket.id)

  if (externalIds.size === 0) return []

  let stmt
  try {
    stmt = db.prepare(`
      SELECT pr_url FROM ${PMO_TABLES.external_execution_prs}
      WHERE external_id = ?
    `)
  } catch {
    // Table may not exist yet (fresh DB or older schema).
    return []
  }

  for (const extId of externalIds) {
    try {
      const rows = stmt.all(extId) as Array<{ pr_url: string }>
      for (const row of rows) urls.add(row.pr_url)
    } catch {
      // Non-fatal: skip this id.
    }
  }

  return [...urls]
}

/**
 * Parse a PR number out of a github.com URL.
 * Accepts both `/pull/123` and `/pull/123/...` shapes.
 */
function parsePRNumberFromUrl(url: string): number | null {
  const m = url.match(/\/pull\/(\d+)(?:\b|\/)/)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

// -----------------------------------------------------------------------------
// Apply (goes through normal state-transition code path)
// -----------------------------------------------------------------------------

/**
 * Apply a transition through the same provider adapter layer that
 * `prlt ticket move` uses. This is load-bearing: it ensures hooks,
 * provider sync, and worktree cleanup all fire.
 */
async function applyTransition(
  db: SqliteDatabase,
  storage: PMOStorage & ProviderStorage,
  transition: ReconcileTransition,
): Promise<void> {
  const ticket = await storage.getTicket(transition.ticketId)
  if (!ticket) {
    throw new Error(`Ticket ${transition.ticketId} vanished between scan and apply`)
  }

  const provider = resolveTicketProvider(
    ticket.id,
    ticket.projectId ?? transition.projectId,
    db,
    storage,
    ticket.metadata,
  )

  const result = await provider.moveTicket(ticket.id, transition.toState)
  if (!result.success) {
    throw new Error(result.error ?? 'moveTicket failed without an error message')
  }
}

/**
 * For tickets whose source of truth is an external provider (Linear,
 * Jira, etc.), the local PMO board can still hold a mirror row. After
 * successfully moving the external ticket, reconcile the local PMO side
 * too so `prlt board` does not drift.
 *
 * Best effort — failures here never block the primary transition.
 */
async function reconcilePmoMirror(
  db: SqliteDatabase,
  storage: PMOStorage & ProviderStorage,
  transition: ReconcileTransition,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const mirror = await storage.getTicket(transition.ticketId)
    if (!mirror) return
    // Only move if the mirror truly holds a different status — that way
    // we stay idempotent and do not fire redundant hooks.
    if (mirror.statusName && mirror.statusName.toLowerCase() === transition.toState.toLowerCase()) {
      return
    }
    // Use the pmo provider directly (bypass resolver so we definitely
    // hit the local mirror, not bounce back to Linear).
    const pmoProvider: TicketProvider = resolveTicketProvider(
      mirror.id,
      mirror.projectId ?? transition.projectId,
      db,
      storage,
      // Strip external_source so the resolver picks PMO.
      null,
    )
    if (pmoProvider.name !== 'pmo') return
    const result = await pmoProvider.moveTicket(mirror.id, transition.toState)
    if (!result.success && log) {
      log(`[reconcile] pmo mirror update for ${mirror.id} failed: ${result.error}`)
    }
  } catch (err) {
    log?.(
      `[reconcile] pmo mirror update for ${transition.ticketId} errored: ` +
        (err instanceof Error ? err.message : String(err)),
    )
  }
}

// -----------------------------------------------------------------------------
// Project / provider resolution helpers
// -----------------------------------------------------------------------------

async function listAllProjectIds(storage: PMOStorage): Promise<string[]> {
  try {
    const projects = await storage.listProjects()
    return projects.map(p => p.id)
  } catch {
    return []
  }
}

/**
 * Resolve the provider name for a ticket without triggering any state
 * resolution or event emission. Used purely so the transition record
 * can log which backend owns the ticket.
 */
function providerNameFor(
  db: SqliteDatabase,
  storage: PMOStorage & ProviderStorage,
  ticket: Ticket,
): string {
  try {
    const provider = resolveTicketProvider(
      ticket.id,
      ticket.projectId ?? '',
      db,
      storage,
      ticket.metadata,
    )
    return provider.name
  } catch {
    return 'pmo'
  }
}

function toReconcileTicket(ticket: Ticket): ReconcileTicket {
  return {
    id: ticket.id,
    title: ticket.title,
    projectId: ticket.projectId,
    statusName: ticket.statusName,
    statusCategory: ticket.statusCategory,
    branch: ticket.branch,
    metadata: ticket.metadata,
  }
}

// -----------------------------------------------------------------------------
// Watch loop
// -----------------------------------------------------------------------------

/**
 * Run the reconciler on a timer until the caller-supplied `shouldStop`
 * callback returns true.
 *
 * Each iteration runs one full {@link runReconcile} cycle and then sleeps
 * for `intervalMs` before the next one. Errors inside a cycle are caught
 * and surfaced via `log` — a single bad cycle never kills the watcher.
 */
export async function watchReconcile(
  db: SqliteDatabase,
  storage: PMOStorage & ProviderStorage,
  options: ReconcileOptions & {
    intervalMs?: number
    shouldStop?: () => boolean
    onCycle?: (report: ReconcileReport) => void
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<void> {
  const {
    intervalMs = 5 * 60 * 1000,
    shouldStop = () => false,
    onCycle,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    log,
  } = options

  // Cycle counter for tests that want to bound the loop.
  let cycle = 0

  while (!shouldStop()) {

    try {
      // eslint-disable-next-line no-await-in-loop
      const report = await runReconcile(db, storage, options)
      cycle += 1
      log?.(
        `[reconcile] cycle ${cycle} complete — checked=${report.checked} ` +
          `applied=${report.applied.length} skipped=${report.skipped.length} ` +
          `failed=${report.failed.length}`,
      )
      onCycle?.(report)
    } catch (err) {
      log?.(
        `[reconcile] cycle failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (shouldStop()) return

    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
  }
}

// Exported for tests that want to call the PR URL parser directly.
export { parsePRNumberFromUrl as _parsePRNumberFromUrl }
