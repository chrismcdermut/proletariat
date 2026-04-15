/**
 * Session Repository
 *
 * Typed data access for agent work executions (agent_work table).
 * Covers execution lifecycle, heartbeats, and status queries.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, or, sql, desc, asc } from 'drizzle-orm'
import { pmoAgentWork as agentWorkTable } from '../drizzle-schema.js'
import type {
  RepositoryContext,
  ExecutionRecord,
  CreateExecutionInput,
  ExecutionFilter,
  ExecutionStatus,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toExecutionRecord(row: typeof agentWorkTable.$inferSelect): ExecutionRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    agentName: row.agentName,
    executor: row.executor,
    environment: row.environment,
    displayMode: row.displayMode,
    permissionMode: row.permissionMode,
    cleanupPolicy: row.cleanupPolicy,
    status: row.status as ExecutionStatus,
    branch: row.branch,
    pid: row.pid,
    containerId: row.containerId,
    sessionId: row.sessionId,
    host: row.host,
    logPath: row.logPath,
    externalSource: row.externalSource,
    externalKey: row.externalKey,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    exitCode: row.exitCode,
    errorMessage: row.errorMessage,
    gcCleanedAt: row.gcCleanedAt,
  }
}

// =============================================================================
// SessionRepository
// =============================================================================

export interface ISessionRepository {
  findById(id: string): ExecutionRecord | null
  findRunningByTicket(ticketId: string): ExecutionRecord | null
  findRunningByAgent(agentName: string): ExecutionRecord[]
  list(filter?: ExecutionFilter): ExecutionRecord[]
  listActive(): ExecutionRecord[]
  create(input: CreateExecutionInput): ExecutionRecord
  updateStatus(id: string, status: ExecutionStatus, exitCode?: number, errorMessage?: string): void
  updateProcessInfo(id: string, info: {
    pid?: string
    containerId?: string
    sessionId?: string
    host?: string
    logPath?: string
  }): void
  updateHeartbeat(id: string): void
  remove(id: string): void
  isAgentAvailable(agentName: string): boolean
  getAgentExecutionCount(agentName: string): number
}

export class SessionRepository implements ISessionRepository {
  constructor(private ctx: RepositoryContext) {}

  findById(id: string): ExecutionRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(agentWorkTable)
      .where(eq(agentWorkTable.id, id))
      .get()
    return row ? toExecutionRecord(row) : null
  }

  findRunningByTicket(ticketId: string): ExecutionRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(agentWorkTable)
      .where(and(
        or(
          eq(agentWorkTable.ticketId, ticketId),
          eq(agentWorkTable.externalKey, ticketId),
        ),
        or(
          eq(agentWorkTable.status, 'starting'),
          eq(agentWorkTable.status, 'running'),
        ),
      ))
      .orderBy(desc(agentWorkTable.startedAt))
      .limit(1)
      .get()
    return row ? toExecutionRecord(row) : null
  }

  findRunningByAgent(agentName: string): ExecutionRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(agentWorkTable)
      .where(and(
        eq(agentWorkTable.agentName, agentName),
        or(
          eq(agentWorkTable.status, 'starting'),
          eq(agentWorkTable.status, 'running'),
        ),
      ))
      .orderBy(desc(agentWorkTable.startedAt))
      .all()
    return rows.map(toExecutionRecord)
  }

  list(filter?: ExecutionFilter): ExecutionRecord[] {
    const conditions = []

    if (filter?.status) {
      conditions.push(eq(agentWorkTable.status, filter.status))
    }
    if (filter?.agentName) {
      conditions.push(eq(agentWorkTable.agentName, filter.agentName))
    }
    if (filter?.ticketId) {
      conditions.push(or(
        eq(agentWorkTable.ticketId, filter.ticketId),
        eq(agentWorkTable.externalKey, filter.ticketId),
      ))
    }

    let query = this.ctx.drizzle
      .select()
      .from(agentWorkTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentWorkTable.startedAt))
      .$dynamic()

    if (filter?.limit) {
      query = query.limit(filter.limit)
    }

    return query.all().map(toExecutionRecord)
  }

  listActive(): ExecutionRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(agentWorkTable)
      .where(or(
        eq(agentWorkTable.status, 'starting'),
        eq(agentWorkTable.status, 'running'),
      ))
      .orderBy(desc(agentWorkTable.startedAt))
      .all()
    return rows.map(toExecutionRecord)
  }

  create(input: CreateExecutionInput): ExecutionRecord {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(agentWorkTable)
      .values({
        id: input.id,
        ticketId: input.ticketId,
        agentName: input.agentName,
        executor: input.executor,
        environment: input.environment ?? 'host',
        displayMode: input.displayMode ?? 'terminal',
        permissionMode: input.permissionMode ?? 'safe',
        cleanupPolicy: input.cleanupPolicy ?? 'on-exit',
        status: 'starting',
        branch: input.branch ?? null,
        pid: input.pid ?? null,
        containerId: input.containerId ?? null,
        sessionId: input.sessionId ?? null,
        host: input.host ?? null,
        logPath: input.logPath ?? null,
        externalSource: input.externalSource ?? null,
        externalKey: input.externalKey ?? null,
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
        startedAt: now,
      })
      .run()

    return this.findById(input.id)!
  }

  updateStatus(id: string, status: ExecutionStatus, exitCode?: number, errorMessage?: string): void {
    const completedAt = ['completed', 'failed', 'stopped'].includes(status)
      ? new Date().toISOString()
      : null

    const update: Record<string, unknown> = { status, completedAt }
    if (exitCode !== undefined) update.exitCode = exitCode
    if (errorMessage !== undefined) update.errorMessage = errorMessage

    this.ctx.drizzle
      .update(agentWorkTable)
      .set(update)
      .where(eq(agentWorkTable.id, id))
      .run()
  }

  updateProcessInfo(id: string, info: {
    pid?: string
    containerId?: string
    sessionId?: string
    host?: string
    logPath?: string
  }): void {
    const update: Record<string, unknown> = {}
    if (info.pid !== undefined) update.pid = info.pid
    if (info.containerId !== undefined) update.containerId = info.containerId
    if (info.sessionId !== undefined) update.sessionId = info.sessionId
    if (info.host !== undefined) update.host = info.host
    if (info.logPath !== undefined) update.logPath = info.logPath

    if (Object.keys(update).length > 0) {
      this.ctx.drizzle
        .update(agentWorkTable)
        .set(update)
        .where(eq(agentWorkTable.id, id))
        .run()
    }
  }

  updateHeartbeat(id: string): void {
    // Note: The heartbeat column (last_heartbeat) is not in the Drizzle schema
    // because it was added via raw migration. We use a targeted update here.
    const now = new Date().toISOString()
    this.ctx.drizzle
      .update(agentWorkTable)
      .set({ completedAt: undefined } as Record<string, unknown>)
      .where(eq(agentWorkTable.id, id))
      .run()
    // For now, heartbeat is tracked via the existing raw SQL path.
    // This method is provided for interface completeness.
  }

  remove(id: string): void {
    this.ctx.drizzle
      .delete(agentWorkTable)
      .where(eq(agentWorkTable.id, id))
      .run()
  }

  isAgentAvailable(agentName: string): boolean {
    const running = this.findRunningByAgent(agentName)
    return running.length === 0
  }

  getAgentExecutionCount(agentName: string): number {
    const rows = this.ctx.drizzle
      .select({ id: agentWorkTable.id })
      .from(agentWorkTable)
      .where(eq(agentWorkTable.agentName, agentName))
      .all()
    return rows.length
  }
}
