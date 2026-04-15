/**
 * PR Repository
 *
 * Typed data access for external execution mappings — the bridge between
 * external issue trackers (Linear, Jira, etc.) and internal executions/PRs.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, desc, sql } from 'drizzle-orm'
import {
  pmoExternalExecutionMap as execMapTable,
  pmoExternalExecutionLinks as execLinksTable,
  pmoExternalExecutionPrs as execPrsTable,
  pmoExternalIssueMap as issueMapTable,
} from '../drizzle-schema.js'
import type {
  RepositoryContext,
  ExternalExecutionMapRecord,
  UpsertExternalExecutionInput,
  ExternalExecutionLinkRecord,
  ExternalExecutionPrRecord,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toExecMapRecord(row: typeof execMapTable.$inferSelect): ExternalExecutionMapRecord {
  return {
    provider: row.provider,
    externalId: row.externalId,
    externalKey: row.externalKey,
    canonicalUrl: row.canonicalUrl,
    latestStateSnapshot: row.latestStateSnapshot,
    lastSyncedAt: row.lastSyncedAt,
    lastSpawnedAt: row.lastSpawnedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toLinkRecord(row: typeof execLinksTable.$inferSelect): ExternalExecutionLinkRecord {
  return {
    provider: row.provider,
    externalId: row.externalId,
    executionId: row.executionId,
    linkedAt: row.linkedAt,
  }
}

function toPrRecord(row: typeof execPrsTable.$inferSelect): ExternalExecutionPrRecord {
  return {
    provider: row.provider,
    externalId: row.externalId,
    prUrl: row.prUrl,
    linkedAt: row.linkedAt,
  }
}

// =============================================================================
// PRRepository
// =============================================================================

export interface IPRRepository {
  // External execution mappings
  findByExternalId(provider: string, externalId: string): ExternalExecutionMapRecord | null
  findByExternalKey(provider: string, externalKey: string): ExternalExecutionMapRecord | null
  upsertMapping(input: UpsertExternalExecutionInput): ExternalExecutionMapRecord

  // Execution links
  linkExecution(provider: string, externalId: string, executionId: string): void
  getExecutionIds(provider: string, externalId: string): string[]
  findMappingsByExecutionId(executionId: string): ExternalExecutionMapRecord[]

  // PR links
  linkPr(provider: string, externalId: string, prUrl: string): void
  getPrUrls(provider: string, externalId: string): string[]

  // External issue map
  findIssueMapping(provider: string, externalId: string): {
    provider: string
    externalId: string
    externalKey: string
    externalUrl: string
    teamKey: string
    syncDirection: string
  } | null
  findIssueMappingByKey(provider: string, externalKey: string): {
    provider: string
    externalId: string
    externalKey: string
    externalUrl: string
    teamKey: string
    syncDirection: string
  } | null
}

export class PRRepository implements IPRRepository {
  constructor(private ctx: RepositoryContext) {}

  // ===========================================================================
  // External Execution Mappings
  // ===========================================================================

  findByExternalId(provider: string, externalId: string): ExternalExecutionMapRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(execMapTable)
      .where(and(
        eq(execMapTable.provider, provider as 'linear' | 'jira' | 'asana' | 'monday' | 'pmo'),
        eq(execMapTable.externalId, externalId),
      ))
      .get()
    return row ? toExecMapRecord(row) : null
  }

  findByExternalKey(provider: string, externalKey: string): ExternalExecutionMapRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(execMapTable)
      .where(and(
        eq(execMapTable.provider, provider as 'linear' | 'jira' | 'asana' | 'monday' | 'pmo'),
        eq(execMapTable.externalKey, externalKey),
      ))
      .get()
    return row ? toExecMapRecord(row) : null
  }

  upsertMapping(input: UpsertExternalExecutionInput): ExternalExecutionMapRecord {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(execMapTable)
      .values({
        provider: input.provider as 'linear' | 'jira' | 'asana' | 'monday' | 'pmo',
        externalId: input.externalId,
        externalKey: input.externalKey ?? null,
        canonicalUrl: input.canonicalUrl ?? null,
        latestStateSnapshot: input.latestStateSnapshot ?? null,
        lastSyncedAt: input.lastSyncedAt ?? null,
        lastSpawnedAt: input.lastSpawnedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [execMapTable.provider, execMapTable.externalId],
        set: {
          externalKey: input.externalKey !== undefined
            ? input.externalKey ?? null
            : sql`COALESCE(${input.externalKey ?? null}, ${execMapTable.externalKey})`,
          canonicalUrl: input.canonicalUrl !== undefined
            ? input.canonicalUrl ?? null
            : sql`COALESCE(${input.canonicalUrl ?? null}, ${execMapTable.canonicalUrl})`,
          latestStateSnapshot: input.latestStateSnapshot !== undefined
            ? input.latestStateSnapshot ?? null
            : sql`COALESCE(${input.latestStateSnapshot ?? null}, ${execMapTable.latestStateSnapshot})`,
          lastSyncedAt: input.lastSyncedAt !== undefined
            ? input.lastSyncedAt ?? null
            : sql`COALESCE(${input.lastSyncedAt ?? null}, ${execMapTable.lastSyncedAt})`,
          lastSpawnedAt: input.lastSpawnedAt !== undefined
            ? input.lastSpawnedAt ?? null
            : sql`COALESCE(${input.lastSpawnedAt ?? null}, ${execMapTable.lastSpawnedAt})`,
          updatedAt: now,
        },
      })
      .run()

    return this.findByExternalId(input.provider, input.externalId)!
  }

  // ===========================================================================
  // Execution Links
  // ===========================================================================

  linkExecution(provider: string, externalId: string, executionId: string): void {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(execLinksTable)
      .values({
        provider,
        externalId,
        executionId,
        linkedAt: now,
      })
      .onConflictDoNothing()
      .run()
  }

  getExecutionIds(provider: string, externalId: string): string[] {
    const rows = this.ctx.drizzle
      .select({ executionId: execLinksTable.executionId })
      .from(execLinksTable)
      .where(and(
        eq(execLinksTable.provider, provider),
        eq(execLinksTable.externalId, externalId),
      ))
      .orderBy(desc(execLinksTable.linkedAt))
      .all()
    return rows.map(r => r.executionId)
  }

  findMappingsByExecutionId(executionId: string): ExternalExecutionMapRecord[] {
    const rows = this.ctx.drizzle
      .select({
        provider: execMapTable.provider,
        externalId: execMapTable.externalId,
        externalKey: execMapTable.externalKey,
        canonicalUrl: execMapTable.canonicalUrl,
        latestStateSnapshot: execMapTable.latestStateSnapshot,
        lastSyncedAt: execMapTable.lastSyncedAt,
        lastSpawnedAt: execMapTable.lastSpawnedAt,
        createdAt: execMapTable.createdAt,
        updatedAt: execMapTable.updatedAt,
      })
      .from(execMapTable)
      .innerJoin(
        execLinksTable,
        and(
          eq(execMapTable.provider, execLinksTable.provider),
          eq(execMapTable.externalId, execLinksTable.externalId),
        ),
      )
      .where(eq(execLinksTable.executionId, executionId))
      .orderBy(desc(execMapTable.updatedAt))
      .all()

    return rows.map(toExecMapRecord)
  }

  // ===========================================================================
  // PR Links
  // ===========================================================================

  linkPr(provider: string, externalId: string, prUrl: string): void {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(execPrsTable)
      .values({
        provider,
        externalId,
        prUrl,
        linkedAt: now,
      })
      .onConflictDoNothing()
      .run()
  }

  getPrUrls(provider: string, externalId: string): string[] {
    const rows = this.ctx.drizzle
      .select({ prUrl: execPrsTable.prUrl })
      .from(execPrsTable)
      .where(and(
        eq(execPrsTable.provider, provider),
        eq(execPrsTable.externalId, externalId),
      ))
      .orderBy(desc(execPrsTable.linkedAt))
      .all()
    return rows.map(r => r.prUrl)
  }

  // ===========================================================================
  // External Issue Map
  // ===========================================================================

  findIssueMapping(provider: string, externalId: string) {
    const row = this.ctx.drizzle
      .select()
      .from(issueMapTable)
      .where(and(
        eq(issueMapTable.provider, provider),
        eq(issueMapTable.externalId, externalId),
      ))
      .get()

    if (!row) return null

    return {
      provider: row.provider,
      externalId: row.externalId,
      externalKey: row.externalKey,
      externalUrl: row.externalUrl,
      teamKey: row.teamKey,
      syncDirection: row.syncDirection,
    }
  }

  findIssueMappingByKey(provider: string, externalKey: string) {
    const row = this.ctx.drizzle
      .select()
      .from(issueMapTable)
      .where(and(
        eq(issueMapTable.provider, provider),
        eq(issueMapTable.externalKey, externalKey),
      ))
      .get()

    if (!row) return null

    return {
      provider: row.provider,
      externalId: row.externalId,
      externalKey: row.externalKey,
      externalUrl: row.externalUrl,
      teamKey: row.teamKey,
      syncDirection: row.syncDirection,
    }
  }
}
