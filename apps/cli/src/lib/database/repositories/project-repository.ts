/**
 * Project Repository
 *
 * Typed data access for projects and project settings.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, like, or, desc, sql } from 'drizzle-orm'
import {
  pmoProjects as projectsTable,
  pmoSettings as settingsTable,
} from '../drizzle-schema.js'
import type {
  RepositoryContext,
  ProjectRecord,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectFilter,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toProjectRecord(row: typeof projectsTable.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    description: row.description,
    status: row.status,
    phaseId: row.phaseId,
    workflowId: row.workflowId,
    isArchived: row.isArchived ?? false,
    targetDate: row.targetDate,
    initiativeId: row.initiativeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// =============================================================================
// ProjectRepository
// =============================================================================

export interface IProjectRepository {
  findById(id: string): ProjectRecord | null
  findByName(name: string): ProjectRecord | null
  list(filter?: ProjectFilter): ProjectRecord[]
  create(input: CreateProjectInput): ProjectRecord
  update(id: string, input: UpdateProjectInput): ProjectRecord
  remove(id: string): void

  // Settings
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  deleteSetting(key: string): void
}

export class ProjectRepository implements IProjectRepository {
  constructor(private ctx: RepositoryContext) {}

  findById(id: string): ProjectRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, id))
      .get()
    return row ? toProjectRecord(row) : null
  }

  findByName(name: string): ProjectRecord | null {
    // Case-insensitive name match
    const row = this.ctx.drizzle
      .select()
      .from(projectsTable)
      .where(sql`LOWER(${projectsTable.name}) = LOWER(${name})`)
      .get()
    return row ? toProjectRecord(row) : null
  }

  /**
   * Resolve a project identifier to its record.
   * Tries: exact ID, case-insensitive ID, exact name, case-insensitive name.
   */
  resolve(identifier: string): ProjectRecord | null {
    // Exact ID
    const byId = this.findById(identifier)
    if (byId) return byId

    // Case-insensitive ID
    const ciId = this.ctx.drizzle
      .select()
      .from(projectsTable)
      .where(sql`LOWER(${projectsTable.id}) = LOWER(${identifier})`)
      .get()
    if (ciId) return toProjectRecord(ciId)

    // Name match
    return this.findByName(identifier)
  }

  list(filter?: ProjectFilter): ProjectRecord[] {
    const conditions = []

    if (filter?.isArchived !== undefined) {
      conditions.push(eq(projectsTable.isArchived, filter.isArchived))
    }

    if (filter?.phaseId) {
      conditions.push(eq(projectsTable.phaseId, filter.phaseId))
    }

    if (filter?.search) {
      conditions.push(or(
        like(projectsTable.name, `%${filter.search}%`),
        like(projectsTable.description, `%${filter.search}%`),
      ))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(projectsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(projectsTable.updatedAt))
      .all()

    return rows.map(toProjectRecord)
  }

  create(input: CreateProjectInput): ProjectRecord {
    const now = String(Date.now())
    const id = input.id || `project-${Date.now()}`
    const workflowId = input.workflowId || input.template || 'default'

    this.ctx.drizzle
      .insert(projectsTable)
      .values({
        id,
        name: input.name,
        template: input.template ?? null,
        description: input.description ?? null,
        workflowId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectsTable.id,
        set: {
          name: input.name,
          template: input.template ?? null,
          description: input.description ?? null,
          workflowId,
          updatedAt: now,
        },
      })
      .run()

    return this.findById(id)!
  }

  update(id: string, input: UpdateProjectInput): ProjectRecord {
    const update: Record<string, unknown> = {
      updatedAt: String(Date.now()),
    }

    if (input.name !== undefined) update.name = input.name
    if (input.description !== undefined) update.description = input.description
    if (input.status !== undefined) update.status = input.status
    if (input.phaseId !== undefined) update.phaseId = input.phaseId
    if (input.workflowId !== undefined) update.workflowId = input.workflowId
    if (input.isArchived !== undefined) update.isArchived = input.isArchived
    if (input.targetDate !== undefined) update.targetDate = input.targetDate
    if (input.initiativeId !== undefined) update.initiativeId = input.initiativeId

    this.ctx.drizzle
      .update(projectsTable)
      .set(update)
      .where(eq(projectsTable.id, id))
      .run()

    return this.findById(id)!
  }

  remove(id: string): void {
    this.ctx.drizzle
      .delete(projectsTable)
      .where(eq(projectsTable.id, id))
      .run()
  }

  // ===========================================================================
  // Settings
  // ===========================================================================

  getSetting(key: string): string | null {
    const row = this.ctx.drizzle
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, key))
      .get()
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.ctx.drizzle
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value },
      })
      .run()
  }

  deleteSetting(key: string): void {
    this.ctx.drizzle
      .delete(settingsTable)
      .where(eq(settingsTable.key, key))
      .run()
  }
}
