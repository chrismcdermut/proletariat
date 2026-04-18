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
 * Everything outside that — webhook listeners, human inbox, supervision
 * tree — is explicitly out of scope per PRLT-1280.
 *
 * PRLT-1282 adds the Tier 2→3 bridge: when the reconciler can't resolve
 * a state deterministically, it pokes the running orchestrator session so
 * an LLM can make a judgment call.
 */

import type Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import type { StateCategory, Ticket, PMOStorage } from '../pmo/types.js'
import type { ProviderStorage, TicketProvider } from '../providers/types.js'
import { resolveTicketProvider } from '../providers/resolver.js'
import type { PRInfo } from '../pr/index.js'
import { getPRForBranch, getPRByNumber, searchAllPRsForTicket } from '../pr/index.js'
import { getWorkflowConfig, type WorkflowConfig } from '../work-lifecycle/settings.js'
import { buildTransition, deriveExpectedState, formatTransitionLogLine } from './core.js'
import {
  DEFAULT_THRESHOLDS,
  EscalationTracker,
  detectWeirdStates,
  formatAlert,
  sendEscalationPoke,
} from './escalation.js'
import type { EscalationContext, EscalationIssue } from './escalation.js'
import type {
  BranchSearchFn,
  LinkedPR,
  PRLookupFn,
  ReconcileOptions,
  ReconcileReport,
  ReconcileTicket,
  ReconcileTransition,
} from './types.js'

export type {
  BranchSearchFn,
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
export { detectWeirdStates, formatAlert, EscalationTracker } from './escalation.js'
export type { EscalationIssue, EscalationIssueType, EscalationThresholds, EscalationContext } from './escalation.js'

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
 * Default branch search. Searches GitHub for PRs whose head branch
 * starts with any of the given ticket IDs.
 */
export const defaultBranchSearch: BranchSearchFn = (ticketIds, cwd) => {
  return searchAllPRsForTicket(ticketIds, cwd)
}

/**
 * Run one reconciliation cycle.
 *
 * Strictly idempotent: if a ticket is already in its expected state the
 * runner computes no transition and touches nothing. Running twice
 * back-to-back produces no redundant side effects.
 */
export async function runReconcile(
  db: Database.Database,
  storage: PMOStorage & ProviderStorage,
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const startedAt = new Date()
  const { dryRun = false, cwd, log, projectId } = options
  const prLookup = options.prLookup ?? defaultPRLookup
  const branchSearch = options.branchSearch ?? defaultBranchSearch

  // Escalation setup (PRLT-1282)
  const escalateTo = options.escalateTo
  const escalationThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.escalationThresholds ?? {}),
  }
  const pokeFn = options.pokeFn ?? (
    (session: string, alert: string) => sendEscalationPoke(session, alert, { cwd })
  )

  // Build a map of running executions for session-idle detection.
  // Only populated when escalation is active.
  let runningExecsByTicket: Map<string, EscalationContext['activeExecutions']> | undefined
  if (escalateTo && options.listRunningExecutions) {
    runningExecsByTicket = new Map()
    for (const exec of options.listRunningExecutions()) {
      if (!exec.ticketId) continue
      const list = runningExecsByTicket.get(exec.ticketId) ?? []
      list.push({
        agentName: exec.agentName,
        startedAt: exec.startedAt,
        sessionId: exec.sessionId,
      })
      runningExecsByTicket.set(exec.ticketId, list)
    }
  }

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
  const escalationIssues: EscalationIssue[] = []
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const ticket of tickets) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential is fine; small N
      const linkedPRs = await gatherLinkedPRs(db, storage, ticket, prLookup, branchSearch, cwd, log)

      const reconcileTicket = toReconcileTicket(ticket)

      if (linkedPRs.length === 0) {
        // No linked PRs — check for escalation (e.g. ticket stalled with no PR)
        if (escalateTo || dryRun) {
          const ctx = buildEscalationContext(ticket, runningExecsByTicket)
          const issues = detectWeirdStates(reconcileTicket, linkedPRs, ctx, escalationThresholds)
          escalationIssues.push(...issues)
        }
        continue
      }

      // Resolve the provider for this ticket so we can log which backend
      // owns it. The actual move happens through the same resolver later
      // in applyTransition() — this is just for the transition record.
      const providerName = providerNameFor(db, storage, ticket)

      const decision = deriveExpectedState(reconcileTicket, linkedPRs, workflowConfig)
      if (!decision) {
        // No deterministic action — check for weird state escalation
        if (escalateTo || dryRun) {
          const ctx = buildEscalationContext(ticket, runningExecsByTicket)
          const issues = detectWeirdStates(reconcileTicket, linkedPRs, ctx, escalationThresholds)
          escalationIssues.push(...issues)
        }
        continue
      }

      transitions.push(
        buildTransition({
          ticket: reconcileTicket,
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

      // Dual-identity tickets (PRLT-1288): reconcile BOTH sides.
      // If primary provider is external (Linear, etc.), also update local PMO mirror.
      // If primary provider is PMO, also update external provider if the ticket has one.
      if (transition.provider !== 'pmo') {
        // eslint-disable-next-line no-await-in-loop
        await reconcilePmoMirror(db, storage, transition, log)
      } else {
        // eslint-disable-next-line no-await-in-loop
        await reconcileExternalMirror(db, storage, transition, log)
      }
    } catch (err) {
      failed.push({
        transition,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ---- Escalation dispatch (PRLT-1282) ----
  const escalated: EscalationIssue[] = []
  const cooledDown: EscalationIssue[] = []
  const escalationDryRun: EscalationIssue[] = []

  if (escalationIssues.length > 0 && escalateTo) {
    // Retrieve or create tracker (persists across watch cycles via closure)
    const tracker = getOrCreateTracker(options)

    for (const issue of escalationIssues) {
      if (dryRun) {
        const alert = formatAlert(issue)
        log?.(`[escalate] [dry-run] would poke ${escalateTo}:\n${alert}`)
        escalationDryRun.push(issue)
        continue
      }

      if (tracker.isInCooldown(issue.ticketId, issue.issueType)) {
        log?.(`[escalate] cooldown: skipping ${issue.ticketId} (${issue.issueType})`)
        cooledDown.push(issue)
        continue
      }

      const alert = formatAlert(issue)
      log?.(`[escalate] poking ${escalateTo} for ${issue.ticketId} (${issue.issueType})`)

      // eslint-disable-next-line no-await-in-loop
      const result = await pokeFn(escalateTo, alert)
      if (result.success) {
        tracker.recordPoke(issue.ticketId, issue.issueType)
        escalated.push(issue)
      } else {
        log?.(`[escalate] poke failed for ${issue.ticketId}: ${result.error}`)
        errors.push({ ticketId: issue.ticketId, error: `escalation poke failed: ${result.error}` })
      }
    }
  } else if (escalationIssues.length > 0) {
    // No --escalate-to set: these are dry-run display items
    escalationDryRun.push(...escalationIssues)
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
    escalated,
    cooledDown,
    escalationDryRun,
  }
}

/**
 * Build escalation context for a ticket from available data.
 */
function buildEscalationContext(
  ticket: Ticket,
  runningExecsByTicket?: Map<string, EscalationContext['activeExecutions']>,
): EscalationContext {
  const md = ticket.metadata ?? {}
  // Use ticket's updatedAt, status_changed_at, or createdAt as proxy
  // for "when did this ticket enter its current state?"
  const ticketUpdatedAt =
    md.status_changed_at ?? ticket.updatedAt ?? ticket.createdAt

  // Collect running executions for this ticket from both its ID and external key
  const execs: NonNullable<EscalationContext['activeExecutions']> = []
  if (runningExecsByTicket) {
    const byId = runningExecsByTicket.get(ticket.id)
    if (byId) execs.push(...byId)
    if (md.external_key) {
      const byKey = runningExecsByTicket.get(md.external_key)
      if (byKey) execs.push(...byKey)
    }
  }

  return {
    ticketUpdatedAt: typeof ticketUpdatedAt === 'string' ? ticketUpdatedAt : undefined,
    activeExecutions: execs.length > 0 ? execs : undefined,
    externalKey: md.external_key,
  }
}

/**
 * Shared escalation tracker — persists across watch cycles via the options
 * object's identity. We store it in a module-level WeakMap keyed by options
 * so each watch loop gets its own tracker but doesn't leak memory.
 */
const trackerCache = new WeakMap<ReconcileOptions, EscalationTracker>()

function getOrCreateTracker(options: ReconcileOptions): EscalationTracker {
  let tracker = trackerCache.get(options)
  if (!tracker) {
    tracker = new EscalationTracker(options.cooldownMinutes ?? 30)
    trackerCache.set(options, tracker)
  }
  return tracker
}

// -----------------------------------------------------------------------------
// PR lookup
// -----------------------------------------------------------------------------

/**
 * Gather every PR linked to a ticket by:
 *   1. the ticket's branch (if set),
 *   2. PR URLs stored in `pmo_external_execution_prs` under any of the
 *      ticket's external-source identities, and
 *   3. (PRLT-1288 fallback) searching GitHub by branch name pattern when
 *      sources 1 & 2 yield nothing.
 *
 * Every lookup goes through the live PR lookup function — no cache.
 * When source 3 finds a PR, the ticket's metadata is backfilled with
 * `pr_number` and `pr_url` so future cycles skip the search.
 */
async function gatherLinkedPRs(
  db: Database.Database,
  storage: PMOStorage & ProviderStorage,
  ticket: Ticket,
  prLookup: PRLookupFn,
  branchSearch: BranchSearchFn,
  cwd?: string,
  log?: (msg: string) => void,
): Promise<LinkedPR[]> {
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

  // 3. PRLT-1288: Branch search fallback — when sources 1 & 2 found nothing,
  //    search GitHub by branch name prefix using every known alias for this
  //    ticket (ticket ID, external_key, external_id).
  if (results.length === 0) {
    const searchIds = collectSearchIds(ticket)
    if (searchIds.length > 0) {
      const found = branchSearch(searchIds, cwd)
      for (const pr of found) {
        push(pr, 'branch_search')
      }
      // Backfill: write pr_number & pr_url onto ticket metadata so future
      // reconcile cycles skip the search. Use the first (best) match.
      if (results.length > 0) {
        const best = results[0].pr
        await backfillPRMetadata(storage, ticket, best, log)
      }
    }
  }

  return results
}

/**
 * Collect every identifier that can serve as a branch-name prefix when
 * searching GitHub for PRs associated with a ticket.
 *
 * Covers: ticket ID (TKT-xxx), external_key (PRLT-xxx), external_id
 * (if it looks like a ticket key, not a UUID).
 */
function collectSearchIds(ticket: Ticket): string[] {
  const ids = new Set<string>()
  const md = ticket.metadata ?? {}

  // The ticket's own ID (e.g. TKT-042)
  ids.add(ticket.id)

  // External key — typically the Linear identifier (e.g. PRLT-1266)
  if (md.external_key) ids.add(md.external_key)

  // External ID — only include if it looks like a ticket key, not a UUID
  if (md.external_id && /^[A-Z]+-\d+$/i.test(md.external_id)) {
    ids.add(md.external_id)
  }

  return [...ids]
}

/**
 * Backfill pr_number and pr_url onto a ticket's metadata so future
 * reconcile cycles find the PR directly without searching GitHub.
 *
 * Best-effort: failures are logged but never block the reconcile cycle.
 */
async function backfillPRMetadata(
  storage: PMOStorage & ProviderStorage,
  ticket: Ticket,
  pr: PRInfo,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const updatedMetadata = {
      ...(ticket.metadata ?? {}),
      pr_number: String(pr.number),
      pr_url: pr.url,
    }
    await storage.updateTicket(ticket.id, { metadata: updatedMetadata })
    log?.(`[reconcile] backfilled pr_number=${pr.number} on ${ticket.id} (found via branch search)`)
  } catch (err) {
    log?.(
      `[reconcile] failed to backfill PR metadata on ${ticket.id}: ` +
        (err instanceof Error ? err.message : String(err)),
    )
  }
}

/**
 * Read every PR URL stored for this ticket in `pmo_external_execution_prs`.
 * Keyed by (provider, external_id) — the reconciler doesn't care which
 * provider it came from, so we union across all of them.
 */
function listLinkedPrUrls(db: Database.Database, ticket: Ticket): string[] {
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
  db: Database.Database,
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
  db: Database.Database,
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

/**
 * For dual-identity tickets whose primary provider resolved to PMO
 * (e.g. because external_source metadata was missing), check whether
 * the ticket also has an external identity (Linear, Jira, etc.) and
 * try to update that side too.
 *
 * Best effort — failures here never block the primary transition.
 */
async function reconcileExternalMirror(
  db: Database.Database,
  storage: PMOStorage & ProviderStorage,
  transition: ReconcileTransition,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    const ticket = await storage.getTicket(transition.ticketId)
    if (!ticket) return
    const md = ticket.metadata ?? {}

    // Only act if the ticket has external-provider metadata
    if (!md.external_source && !md.external_key && !md.external_id) return

    // Build metadata that forces the resolver to pick the external provider
    const externalMetadata: Record<string, string> = { ...md }
    // If external_source is missing but external_key/external_id exists,
    // try to infer the source from the key format (PRLT-xxx → linear)
    if (!externalMetadata.external_source && externalMetadata.external_key) {
      if (/^PRLT-\d+$/.test(externalMetadata.external_key)) {
        externalMetadata.external_source = 'linear'
      }
    }
    if (!externalMetadata.external_source) return

    const externalProvider = resolveTicketProvider(
      ticket.id,
      ticket.projectId ?? transition.projectId,
      db,
      storage,
      externalMetadata,
    )

    // Don't bounce back to PMO — that's the primary provider we already used
    if (externalProvider.name === 'pmo') return

    const result = await externalProvider.moveTicket(ticket.id, transition.toState)
    if (result.success) {
      log?.(`[reconcile] also moved ${ticket.id} on ${externalProvider.name} → ${transition.toState}`)
    } else if (log) {
      log(`[reconcile] external mirror update for ${ticket.id} on ${externalProvider.name} failed: ${result.error}`)
    }
  } catch (err) {
    log?.(
      `[reconcile] external mirror update for ${transition.ticketId} errored: ` +
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
  db: Database.Database,
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
  db: Database.Database,
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
