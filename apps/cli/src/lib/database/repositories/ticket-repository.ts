/**
 * Ticket Repository
 *
 * Typed data access for ticket references (runtime cache), ticket metadata,
 * and ticket templates. The actual ticket source of truth lives in external
 * providers (Linear, Jira, etc.) — this repository manages the local cache
 * and templates.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, like, or, asc, desc } from 'drizzle-orm'
import {
  pmoTicketRefs as ticketRefsTable,
  pmoTicketMetadata as ticketMetadataTable,
  pmoTicketTemplates as ticketTemplatesTable,
} from '../drizzle-schema.js'
import type {
  RepositoryContext,
  TicketRefRecord,
  UpsertTicketRefInput,
  TicketRefFilter,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toTicketRefRecord(row: typeof ticketRefsTable.$inferSelect): TicketRefRecord {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    externalKey: row.externalKey,
    externalUrl: row.externalUrl,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assignee: row.assignee,
    projectId: row.projectId,
    cachedAt: row.cachedAt,
    updatedAt: row.updatedAt,
  }
}

// =============================================================================
// Template Types
// =============================================================================

export interface TicketTemplateRecord {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  titlePattern: string | null
  descriptionTemplate: string | null
  defaultPriority: string | null
  defaultCategory: string | null
  defaultStatusId: string | null
  defaultAssignee: string | null
  defaultOwner: string | null
  defaultLabels: string
  suggestedSubtasks: string
  createdAt: string | null
}

export interface CreateTicketTemplateInput {
  id?: string
  name: string
  description?: string
  isBuiltin?: boolean
  titlePattern?: string
  descriptionTemplate?: string
  defaultPriority?: string
  defaultCategory?: string
  defaultStatusId?: string
  defaultAssignee?: string
  defaultOwner?: string
  defaultLabels?: string[]
  suggestedSubtasks?: string[]
}

export interface TicketTemplateFilter {
  isBuiltin?: boolean
  search?: string
}

// =============================================================================
// TicketRepository
// =============================================================================

export interface ITicketRepository {
  // Ticket refs (runtime cache)
  findRefById(id: string): TicketRefRecord | null
  findRefByExternalKey(provider: string, externalKey: string): TicketRefRecord | null
  listRefs(filter?: TicketRefFilter): TicketRefRecord[]
  upsertRef(input: UpsertTicketRefInput): TicketRefRecord
  removeRef(id: string): void

  // Ticket metadata (key-value)
  getMetadata(ticketId: string, key: string): string | null
  setMetadata(ticketId: string, key: string, value: string): void
  deleteMetadata(ticketId: string, key: string): void
  getAllMetadata(ticketId: string): Array<{ key: string; value: string | null }>

  // Ticket templates
  findTemplateById(id: string): TicketTemplateRecord | null
  listTemplates(filter?: TicketTemplateFilter): TicketTemplateRecord[]
  createTemplate(input: CreateTicketTemplateInput): TicketTemplateRecord
  updateTemplate(id: string, input: Partial<CreateTicketTemplateInput>): TicketTemplateRecord
  deleteTemplate(id: string): void
}

export class TicketRepository implements ITicketRepository {
  constructor(private ctx: RepositoryContext) {}

  // ===========================================================================
  // Ticket Refs (Runtime Cache)
  // ===========================================================================

  findRefById(id: string): TicketRefRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(ticketRefsTable)
      .where(eq(ticketRefsTable.id, id))
      .get()
    return row ? toTicketRefRecord(row) : null
  }

  findRefByExternalKey(provider: string, externalKey: string): TicketRefRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(ticketRefsTable)
      .where(and(
        eq(ticketRefsTable.provider, provider),
        eq(ticketRefsTable.externalKey, externalKey),
      ))
      .get()
    return row ? toTicketRefRecord(row) : null
  }

  listRefs(filter?: TicketRefFilter): TicketRefRecord[] {
    const conditions = []

    if (filter?.provider) {
      conditions.push(eq(ticketRefsTable.provider, filter.provider))
    }
    if (filter?.status) {
      conditions.push(eq(ticketRefsTable.status, filter.status))
    }
    if (filter?.projectId) {
      conditions.push(eq(ticketRefsTable.projectId, filter.projectId))
    }
    if (filter?.externalKey) {
      conditions.push(eq(ticketRefsTable.externalKey, filter.externalKey))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(ticketRefsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ticketRefsTable.updatedAt))
      .all()

    return rows.map(toTicketRefRecord)
  }

  upsertRef(input: UpsertTicketRefInput): TicketRefRecord {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(ticketRefsTable)
      .values({
        id: input.id,
        provider: input.provider ?? 'pmo',
        externalId: input.externalId ?? null,
        externalKey: input.externalKey ?? null,
        externalUrl: input.externalUrl ?? null,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? null,
        priority: input.priority ?? null,
        category: input.category ?? null,
        assignee: input.assignee ?? null,
        projectId: input.projectId ?? null,
        cachedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ticketRefsTable.id,
        set: {
          provider: input.provider ?? 'pmo',
          externalId: input.externalId ?? null,
          externalKey: input.externalKey ?? null,
          externalUrl: input.externalUrl ?? null,
          title: input.title,
          description: input.description ?? null,
          status: input.status ?? null,
          priority: input.priority ?? null,
          category: input.category ?? null,
          assignee: input.assignee ?? null,
          projectId: input.projectId ?? null,
          updatedAt: now,
        },
      })
      .run()

    return this.findRefById(input.id)!
  }

  removeRef(id: string): void {
    this.ctx.drizzle
      .delete(ticketRefsTable)
      .where(eq(ticketRefsTable.id, id))
      .run()
  }

  // ===========================================================================
  // Ticket Metadata (Key-Value)
  // ===========================================================================

  getMetadata(ticketId: string, key: string): string | null {
    const row = this.ctx.drizzle
      .select({ value: ticketMetadataTable.value })
      .from(ticketMetadataTable)
      .where(and(
        eq(ticketMetadataTable.ticketId, ticketId),
        eq(ticketMetadataTable.key, key),
      ))
      .get()
    return row?.value ?? null
  }

  setMetadata(ticketId: string, key: string, value: string): void {
    this.ctx.drizzle
      .insert(ticketMetadataTable)
      .values({ ticketId, key, value })
      .onConflictDoUpdate({
        target: [ticketMetadataTable.ticketId, ticketMetadataTable.key],
        set: { value },
      })
      .run()
  }

  deleteMetadata(ticketId: string, key: string): void {
    this.ctx.drizzle
      .delete(ticketMetadataTable)
      .where(and(
        eq(ticketMetadataTable.ticketId, ticketId),
        eq(ticketMetadataTable.key, key),
      ))
      .run()
  }

  getAllMetadata(ticketId: string): Array<{ key: string; value: string | null }> {
    return this.ctx.drizzle
      .select({ key: ticketMetadataTable.key, value: ticketMetadataTable.value })
      .from(ticketMetadataTable)
      .where(eq(ticketMetadataTable.ticketId, ticketId))
      .all()
  }

  // ===========================================================================
  // Ticket Templates
  // ===========================================================================

  findTemplateById(id: string): TicketTemplateRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(ticketTemplatesTable)
      .where(eq(ticketTemplatesTable.id, id))
      .get()

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isBuiltin: row.isBuiltin === true,
      titlePattern: row.titlePattern,
      descriptionTemplate: row.descriptionTemplate,
      defaultPriority: row.defaultPriority,
      defaultCategory: row.defaultCategory,
      defaultStatusId: row.defaultStatusId,
      defaultAssignee: row.defaultAssignee,
      defaultOwner: row.defaultOwner,
      defaultLabels: row.defaultLabels,
      suggestedSubtasks: row.suggestedSubtasks,
      createdAt: row.createdAt,
    }
  }

  listTemplates(filter?: TicketTemplateFilter): TicketTemplateRecord[] {
    const conditions = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push(eq(ticketTemplatesTable.isBuiltin, filter.isBuiltin))
    }

    if (filter?.search) {
      conditions.push(or(
        like(ticketTemplatesTable.name, `%${filter.search}%`),
        like(ticketTemplatesTable.description, `%${filter.search}%`),
      ))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(ticketTemplatesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(ticketTemplatesTable.name))
      .all()

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isBuiltin: row.isBuiltin === true,
      titlePattern: row.titlePattern,
      descriptionTemplate: row.descriptionTemplate,
      defaultPriority: row.defaultPriority,
      defaultCategory: row.defaultCategory,
      defaultStatusId: row.defaultStatusId,
      defaultAssignee: row.defaultAssignee,
      defaultOwner: row.defaultOwner,
      defaultLabels: row.defaultLabels,
      suggestedSubtasks: row.suggestedSubtasks,
      createdAt: row.createdAt,
    }))
  }

  createTemplate(input: CreateTicketTemplateInput): TicketTemplateRecord {
    const now = new Date().toISOString()
    const id = input.id || slugify(input.name)

    this.ctx.drizzle
      .insert(ticketTemplatesTable)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        isBuiltin: input.isBuiltin ?? false,
        titlePattern: input.titlePattern ?? null,
        descriptionTemplate: input.descriptionTemplate ?? null,
        defaultPriority: input.defaultPriority ?? null,
        defaultCategory: input.defaultCategory ?? null,
        defaultStatusId: input.defaultStatusId ?? null,
        defaultAssignee: input.defaultAssignee ?? null,
        defaultOwner: input.defaultOwner ?? null,
        defaultLabels: input.defaultLabels ? JSON.stringify(input.defaultLabels) : '[]',
        suggestedSubtasks: input.suggestedSubtasks ? JSON.stringify(input.suggestedSubtasks) : '[]',
        createdAt: now,
      })
      .run()

    return this.findTemplateById(id)!
  }

  updateTemplate(id: string, input: Partial<CreateTicketTemplateInput>): TicketTemplateRecord {
    const update: Record<string, unknown> = {}

    if (input.name !== undefined) update.name = input.name
    if (input.description !== undefined) update.description = input.description ?? null
    if (input.titlePattern !== undefined) update.titlePattern = input.titlePattern ?? null
    if (input.descriptionTemplate !== undefined) update.descriptionTemplate = input.descriptionTemplate ?? null
    if (input.defaultPriority !== undefined) update.defaultPriority = input.defaultPriority ?? null
    if (input.defaultCategory !== undefined) update.defaultCategory = input.defaultCategory ?? null
    if (input.defaultStatusId !== undefined) update.defaultStatusId = input.defaultStatusId ?? null
    if (input.defaultAssignee !== undefined) update.defaultAssignee = input.defaultAssignee ?? null
    if (input.defaultOwner !== undefined) update.defaultOwner = input.defaultOwner ?? null
    if (input.defaultLabels !== undefined) {
      update.defaultLabels = JSON.stringify(input.defaultLabels ?? [])
    }
    if (input.suggestedSubtasks !== undefined) {
      update.suggestedSubtasks = JSON.stringify(input.suggestedSubtasks ?? [])
    }

    if (Object.keys(update).length > 0) {
      this.ctx.drizzle
        .update(ticketTemplatesTable)
        .set(update)
        .where(eq(ticketTemplatesTable.id, id))
        .run()
    }

    return this.findTemplateById(id)!
  }

  deleteTemplate(id: string): void {
    this.ctx.drizzle
      .delete(ticketTemplatesTable)
      .where(eq(ticketTemplatesTable.id, id))
      .run()
  }
}

// =============================================================================
// Utility
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
