/**
 * Session Renderer (PRLT-1272)
 *
 * Unified machine-wide session collection and grouped rendering.
 *
 * The principle: `prlt session list`, `prlt orchestrator status`, and related
 * commands should ALWAYS query machine-wide for all sessions, regardless of
 * whether the user is inside an HQ. Sessions are then visually grouped by
 * their originating HQ — the current HQ bubbles to the top, other locations
 * are still visible but de-emphasized.
 *
 * Sources collected:
 *   1. machine.db `executions` table — cross-repo ticketless and ticketed work
 *   2. Each registered HQ's workspace.db `agent_work` table — per-HQ workers
 *   3. Discovered tmux/Docker orchestrator sessions — detected by name prefix
 *
 * Each entry is annotated with its hqPath/hqName/role so the renderer can
 * group them.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import { ExecutionStorage } from '../execution/storage.js'
import { openWorkspaceDatabase } from '../database/index.js'
import { MachineDB, type MachineExecution } from '../machine-db.js'
import {
  getRegisteredHeadquarters,
  getHeadquartersNameFromPath,
  normalizePath,
  type RegisteredHeadquarters,
} from '../machine-config.js'
import {
  checkContainerLiveness,
  discoverSessionId,
  findContainerSessionsByPrefix,
  getContainerTmuxSessionMap,
  getHostTmuxSessionNames,
  isContainerEnvironment,
  isSessionAlive,
} from '../execution/session-utils.js'
import { findHQRoot } from '../workspace.js'
import type { AgentWork } from '../execution/types.js'

// =============================================================================
// Types
// =============================================================================

export type SessionRole = 'orchestrator' | 'worker' | 'headless'

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'died'
  | 'stale'
  | 'stopped'
  | 'completed'
  | 'failed'

/**
 * A unified session record representing one running agent on the machine.
 *
 * Sessions originate from three sources:
 *   - workspace.db (per-HQ agent_work table) → workers, ticketed
 *   - machine.db (cross-repo executions table) → ticketless
 *   - tmux/Docker discovery → orchestrators (named prlt-orchestrator-*)
 */
export interface UnifiedSession {
  /** Stable identifier — sessionId where present, else execution id */
  id: string
  /** tmux session name (or container synthetic id) */
  sessionId: string
  /** Ticket id (e.g., 'PRLT-123', 'orchestrator', 'headless') */
  ticketId: string
  /** Agent name (display) */
  agentName: string
  /** Status — running/idle/stale/etc. */
  status: SessionStatus
  /** Role — orchestrator vs worker vs headless */
  role: SessionRole
  /** Execution environment */
  environment: 'host' | 'container'
  /** Container id (for container envs) */
  containerId?: string
  /** Whether the runtime is verified alive */
  exists: boolean
  /** When this session started (best effort) */
  startedAt?: Date
  /** Last heartbeat (workers only) */
  lastHeartbeat?: Date
  /** Lifecycle state from DB (workers only) */
  lifecycleState?: string
  /** HQ path this session originated from, if known */
  hqPath?: string
  /** HQ name (display) */
  hqName?: string
  /** Repo path the agent ran in (machine.db only, may differ from HQ) */
  repoPath?: string
}

export interface CollectOptions {
  /** Include only sessions in this HQ path */
  hqPathFilter?: string
  /** Filter to specific role */
  roleFilter?: SessionRole
  /** Include stopped/completed sessions (default: only active runtimes) */
  includeAll?: boolean
}

export interface GroupedSessions {
  /** Path of the HQ the user is currently in (resolved from cwd), if any */
  currentHq?: string
  currentHqName?: string
  /** Sessions belonging to the current HQ */
  here: UnifiedSession[]
  /** Sessions in other HQs or headless */
  elsewhere: UnifiedSession[]
}

// =============================================================================
// Tmux/Docker discovery snapshot
// =============================================================================

interface RuntimeSnapshot {
  hostTmuxSessions: string[]
  containerTmuxSessions: Map<string, string[]>
}

function captureRuntimeSnapshot(): RuntimeSnapshot {
  return {
    hostTmuxSessions: getHostTmuxSessionNames(),
    containerTmuxSessions: getContainerTmuxSessionMap(),
  }
}

// =============================================================================
// Docker orchestrator discovery
// =============================================================================

interface OrchestratorContainer {
  name: string
  containerId: string
}

function findRunningOrchestratorContainers(): OrchestratorContainer[] {
  try {
    const output = execSync(
      'docker ps --filter "name=prlt-orchestrator-" --format "{{.Names}}\t{{.ID}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (!output) return []
    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, id] = line.split('\t')
        return { name, containerId: id }
      })
  } catch {
    return []
  }
}

// =============================================================================
// HQ resolution helpers
// =============================================================================

/**
 * Sanitize a name segment for use in tmux session names.
 * Mirror of orchestrator/start.ts sanitizeName() — duplicated here to avoid
 * importing a command file from a lib helper (cycle risk).
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Build the orchestrator session prefix used by `prlt orchestrator start`.
 * Format: `prlt-orchestrator-{sanitizedHqName}-`
 */
function orchestratorPrefixForHq(hqName: string): string {
  return `prlt-orchestrator-${sanitizeName(hqName) || 'default'}-`
}

/**
 * Try to attribute an orchestrator session/container name to one of the
 * registered HQs. Returns the matching HQ entry, or null if no match.
 */
function attributeOrchestratorToHq(
  sessionName: string,
  registered: RegisteredHeadquarters[],
): { hqPath: string; hqName: string; orchestratorName: string } | null {
  for (const hq of registered) {
    const hqName = getHeadquartersNameFromPath(hq.path)
    const prefix = orchestratorPrefixForHq(hqName)
    if (sessionName.startsWith(prefix)) {
      return {
        hqPath: hq.path,
        hqName,
        orchestratorName: sessionName.slice(prefix.length),
      }
    }
  }
  return null
}

/**
 * Replace the user's home directory in a path with `~` for display.
 */
export function tildifyPath(p: string): string {
  if (!p) return p
  const home = process.env.HOME || os.homedir()
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  return p
}

// =============================================================================
// Workspace.db (per-HQ) collection
// =============================================================================

function collectFromWorkspaceDb(
  hqPath: string,
  hqName: string,
  snapshot: RuntimeSnapshot,
  includeAll: boolean,
): UnifiedSession[] {
  const sessions: UnifiedSession[] = []
  let db: Database.Database | null = null

  try {
    db = openWorkspaceDatabase(hqPath)
  } catch {
    return sessions
  }

  try {
    const storage = new ExecutionStorage(db)

    // Active executions (running + starting)
    const active: AgentWork[] = [
      ...storage.listExecutions({ status: 'running' }),
      ...storage.listExecutions({ status: 'starting' }),
    ]

    // Self-healing: also check stopped records that may have a live tmux session
    if (includeAll) {
      active.push(...storage.listExecutions({ status: 'stopped' }))
    } else {
      // Promote any stopped executions whose tmux sessions are still alive.
      const stopped = storage.listExecutions({ status: 'stopped' })
      for (const exec of stopped) {
        if (isSessionAlive(exec)) {
          active.push(exec)
        }
      }
    }

    for (const exec of active) {
      const isContainer = isContainerEnvironment(exec.environment)
      let exists = false
      let actualSessionId =
        discoverSessionId(exec, snapshot.hostTmuxSessions, snapshot.containerTmuxSessions) ||
        exec.sessionId

      if (isContainer && exec.containerId) {
        const containerStatus = checkContainerLiveness(exec.containerId)
        if (containerStatus === 'running') {
          if (actualSessionId) {
            const containerSessions = findContainerSessionsByPrefix(
              snapshot.containerTmuxSessions,
              exec.containerId,
            )
            exists = containerSessions.includes(actualSessionId)
          }
          if (!exists) {
            // Container running but no tmux session — still counts as alive.
            exists = true
            actualSessionId =
              actualSessionId || `container:${exec.containerId.substring(0, 12)}`
          }
        }
      } else if (actualSessionId) {
        exists = snapshot.hostTmuxSessions.includes(actualSessionId)
      }

      if (!actualSessionId) continue
      if (!exists && !includeAll) continue

      // Determine role: agentName 'orchestrator-*' or ticketId 'ORCH'
      let role: SessionRole = 'worker'
      if (
        exec.agentName.startsWith('orchestrator') ||
        exec.ticketId === 'ORCH' ||
        exec.ticketId === 'orchestrator'
      ) {
        role = 'orchestrator'
      }

      sessions.push({
        id: exec.id,
        sessionId: actualSessionId,
        ticketId: exec.ticketId,
        agentName: exec.agentName,
        status: deriveStatus(exec.status, exists, exec.lifecycleState),
        role,
        environment: isContainer ? 'container' : 'host',
        containerId: exec.containerId,
        exists,
        startedAt: exec.startedAt,
        lastHeartbeat: exec.lastHeartbeat,
        lifecycleState: exec.lifecycleState,
        hqPath,
        hqName,
        repoPath: hqPath,
      })
    }
  } finally {
    db.close()
  }

  return sessions
}

function deriveStatus(
  rawStatus: string,
  exists: boolean,
  lifecycleState?: string,
): SessionStatus {
  if (lifecycleState === 'died') return 'died'
  if (lifecycleState === 'idle') return 'idle'
  if (!exists) return 'stale'
  return (rawStatus as SessionStatus) || 'running'
}

// =============================================================================
// machine.db collection
// =============================================================================

function collectFromMachineDb(
  snapshot: RuntimeSnapshot,
  registered: RegisteredHeadquarters[],
  alreadySeenSessionIds: Set<string>,
  includeAll: boolean,
): UnifiedSession[] {
  const sessions: UnifiedSession[] = []
  let db: MachineDB | null = null

  try {
    db = new MachineDB()
  } catch {
    return sessions
  }

  try {
    const machineExecs: MachineExecution[] = includeAll
      ? db.listExecutions()
      : db.getActiveExecutions()

    for (const exec of machineExecs) {
      // Skip duplicates already collected from a workspace.db.
      if (exec.sessionId && alreadySeenSessionIds.has(exec.sessionId)) continue

      const isContainer = exec.environment === 'docker' || exec.environment === 'devcontainer'
      let exists = false
      let actualSessionId = exec.sessionId

      if (isContainer && exec.containerId) {
        const status = checkContainerLiveness(exec.containerId)
        if (status === 'running') {
          if (exec.sessionId) {
            const containerSessions = findContainerSessionsByPrefix(
              snapshot.containerTmuxSessions,
              exec.containerId,
            )
            exists = containerSessions.includes(exec.sessionId)
          }
          if (!exists) {
            exists = true
            actualSessionId =
              actualSessionId || `container:${exec.containerId.substring(0, 12)}`
          }
        }
      } else if (exec.sessionId) {
        exists = snapshot.hostTmuxSessions.includes(exec.sessionId)
      }

      if (!actualSessionId) continue
      if (!exists && !includeAll) continue

      // Attribute repoPath to a registered HQ if possible.
      const matchedHq = matchRepoToHq(exec.repoPath, registered)

      // Detect role
      let role: SessionRole = exec.ticketId ? 'worker' : 'headless'
      if (
        exec.agentName.startsWith('orchestrator') ||
        exec.ticketId === 'ORCH' ||
        exec.ticketId === 'orchestrator'
      ) {
        role = 'orchestrator'
      }

      sessions.push({
        id: exec.id,
        sessionId: actualSessionId,
        ticketId: exec.ticketId || exec.id,
        agentName: exec.agentName,
        status: deriveStatus(exec.status, exists),
        role,
        environment: isContainer ? 'container' : 'host',
        containerId: exec.containerId,
        exists,
        startedAt: exec.startedAt,
        hqPath: matchedHq?.hqPath,
        hqName: matchedHq?.hqName,
        repoPath: exec.repoPath,
      })
    }
  } finally {
    db.close()
  }

  return sessions
}

/**
 * Match a repo path to one of the registered HQs.
 * A repo is considered to belong to an HQ if it lives inside the HQ tree
 * (e.g. an agent worktree under `<hqPath>/agents/...`).
 */
function matchRepoToHq(
  repoPath: string | undefined,
  registered: RegisteredHeadquarters[],
): { hqPath: string; hqName: string } | null {
  if (!repoPath) return null
  let normalized: string
  try {
    normalized = normalizePath(repoPath)
  } catch {
    normalized = repoPath
  }

  for (const hq of registered) {
    let hqNormalized: string
    try {
      hqNormalized = normalizePath(hq.path)
    } catch {
      hqNormalized = hq.path
    }
    if (normalized === hqNormalized || normalized.startsWith(hqNormalized + path.sep)) {
      return { hqPath: hq.path, hqName: getHeadquartersNameFromPath(hq.path) }
    }
  }
  return null
}

// =============================================================================
// Orchestrator discovery (tmux + Docker)
// =============================================================================

function collectOrchestrators(
  snapshot: RuntimeSnapshot,
  registered: RegisteredHeadquarters[],
  alreadySeenSessionIds: Set<string>,
): UnifiedSession[] {
  const sessions: UnifiedSession[] = []

  // Host tmux orchestrator sessions
  for (const sessionName of snapshot.hostTmuxSessions) {
    if (!sessionName.startsWith('prlt-orchestrator-')) continue
    if (alreadySeenSessionIds.has(sessionName)) continue

    const attribution = attributeOrchestratorToHq(sessionName, registered)
    sessions.push({
      id: sessionName,
      sessionId: sessionName,
      ticketId: 'orchestrator',
      agentName: attribution?.orchestratorName || sessionName,
      status: 'running',
      role: 'orchestrator',
      environment: 'host',
      exists: true,
      hqPath: attribution?.hqPath,
      hqName: attribution?.hqName,
      repoPath: attribution?.hqPath,
    })
  }

  // Docker orchestrator containers
  const dockerOrchestrators = findRunningOrchestratorContainers()
  for (const { name, containerId } of dockerOrchestrators) {
    if (alreadySeenSessionIds.has(name)) continue

    const attribution = attributeOrchestratorToHq(name, registered)
    sessions.push({
      id: name,
      sessionId: name,
      ticketId: 'orchestrator',
      agentName: attribution?.orchestratorName || name,
      status: 'running',
      role: 'orchestrator',
      environment: 'container',
      containerId,
      exists: true,
      hqPath: attribution?.hqPath,
      hqName: attribution?.hqName,
      repoPath: attribution?.hqPath,
    })
  }

  return sessions
}

// =============================================================================
// Public API: collect + group
// =============================================================================

/**
 * Collect all sessions on the machine, regardless of cwd.
 *
 * Queries:
 *   1. machine.db (cross-repo executions, source of truth for ticketless work)
 *   2. Every registered HQ's workspace.db (workers per HQ)
 *   3. tmux/Docker (orchestrators by name prefix)
 *
 * Filters are applied at the end so the underlying machine query path is
 * the same in every command.
 */
export function collectAllSessions(options: CollectOptions = {}): UnifiedSession[] {
  const snapshot = captureRuntimeSnapshot()
  const registered = getRegisteredHeadquarters().filter(hq => fs.existsSync(hq.path))

  const seenSessionIds = new Set<string>()
  const all: UnifiedSession[] = []

  // 1) Per-HQ workspace databases (workers + locally tracked orchestrators).
  for (const hq of registered) {
    const hqName = getHeadquartersNameFromPath(hq.path)
    const fromHq = collectFromWorkspaceDb(hq.path, hqName, snapshot, options.includeAll === true)
    for (const s of fromHq) {
      if (s.sessionId) seenSessionIds.add(s.sessionId)
      all.push(s)
    }
  }

  // 2) machine.db ticketless / cross-repo executions
  const fromMachine = collectFromMachineDb(
    snapshot,
    registered,
    seenSessionIds,
    options.includeAll === true,
  )
  for (const s of fromMachine) {
    if (s.sessionId) seenSessionIds.add(s.sessionId)
    all.push(s)
  }

  // 3) Discovered orchestrator tmux/Docker sessions not yet covered by a DB
  const discoveredOrchestrators = collectOrchestrators(snapshot, registered, seenSessionIds)
  for (const s of discoveredOrchestrators) {
    if (s.sessionId) seenSessionIds.add(s.sessionId)
    all.push(s)
  }

  // Apply filters
  let filtered = all
  if (options.hqPathFilter) {
    let normalized: string
    try {
      normalized = normalizePath(options.hqPathFilter)
    } catch {
      normalized = options.hqPathFilter
    }
    filtered = filtered.filter(s => {
      if (!s.hqPath) return false
      try {
        return normalizePath(s.hqPath) === normalized
      } catch {
        return s.hqPath === normalized
      }
    })
  }

  if (options.roleFilter) {
    filtered = filtered.filter(s => s.role === options.roleFilter)
  }

  return filtered
}

/**
 * Group sessions into "current HQ" vs "other locations" buckets.
 *
 * The current HQ is resolved from `process.cwd()` (or an explicit override).
 * Sessions whose hqPath matches the current HQ go into `here`; everything
 * else goes into `elsewhere`.
 */
export function groupSessionsByHQ(
  sessions: UnifiedSession[],
  currentHqOverride?: string | null,
): GroupedSessions {
  const currentHq =
    currentHqOverride === null
      ? undefined
      : currentHqOverride ?? findHQRoot(process.cwd()) ?? undefined

  let normalizedCurrent: string | undefined
  if (currentHq) {
    try {
      normalizedCurrent = normalizePath(currentHq)
    } catch {
      normalizedCurrent = currentHq
    }
  }

  const here: UnifiedSession[] = []
  const elsewhere: UnifiedSession[] = []

  for (const s of sessions) {
    if (!normalizedCurrent || !s.hqPath) {
      elsewhere.push(s)
      continue
    }
    let normalizedSession: string
    try {
      normalizedSession = normalizePath(s.hqPath)
    } catch {
      normalizedSession = s.hqPath
    }
    if (normalizedSession === normalizedCurrent) {
      here.push(s)
    } else {
      elsewhere.push(s)
    }
  }

  return {
    currentHq,
    currentHqName: currentHq ? getHeadquartersNameFromPath(currentHq) : undefined,
    here,
    elsewhere,
  }
}

// =============================================================================
// Pretty rendering helpers (text)
// =============================================================================

/** Format a Date into a compact relative duration like "~15m", "~3h", "~2d". */
export function formatRelativeAge(start?: Date, now: Date = new Date()): string {
  if (!start) return ''
  const diffMs = Math.max(0, now.getTime() - start.getTime())
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `~${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `~${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `~${hr}h`
  const day = Math.floor(hr / 24)
  return `~${day}d`
}

/**
 * Group elsewhere sessions by hqPath/hqName for nicer rendering.
 * Sessions without an hqPath are bucketed under "(no HQ)".
 */
export function bucketElsewhereByHq(
  elsewhere: UnifiedSession[],
): Array<{ hqPath: string | null; hqName: string; sessions: UnifiedSession[] }> {
  const buckets = new Map<string, { hqPath: string | null; hqName: string; sessions: UnifiedSession[] }>()
  for (const s of elsewhere) {
    const key = s.hqPath ?? '__none__'
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        hqPath: s.hqPath ?? null,
        hqName: s.hqName ?? '(no HQ)',
        sessions: [],
      }
      buckets.set(key, bucket)
    }
    bucket.sessions.push(s)
  }
  return Array.from(buckets.values())
}
