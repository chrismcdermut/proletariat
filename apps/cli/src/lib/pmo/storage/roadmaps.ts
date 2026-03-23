/**
 * Roadmap operations for PMO.
 * Roadmaps are curated collections of projects for documentation/visualization.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, desc, asc, sql, gte, gt, lt, lte } from 'drizzle-orm'
import {
  pmoRoadmaps,
  pmoRoadmapProjects,
  pmoProjects,
} from '../../database/drizzle-schema.js'
import { Roadmap, RoadmapProject, RoadmapFilter, PMOError, Project } from '../types.js'
import { StorageContext } from './types.js'

export class RoadmapStorage {
  constructor(private ctx: StorageContext) {}

  // ===== Roadmap CRUD =====

  /**
   * Create a new roadmap.
   */
  async createRoadmap(roadmap: Partial<Roadmap> & { name: string }): Promise<Roadmap> {
    const id = roadmap.id || `roadmap-${Date.now()}`
    const now = new Date().toISOString()

    // If setting as default, unset other defaults first
    if (roadmap.isDefault) {
      this.ctx.drizzle
        .update(pmoRoadmaps)
        .set({ isDefault: false })
        .run()
    }

    this.ctx.drizzle.insert(pmoRoadmaps).values({
      id,
      name: roadmap.name,
      description: roadmap.description || null,
      isDefault: roadmap.isDefault || false,
      createdAt: now,
      updatedAt: now,
    }).run()

    return {
      id,
      name: roadmap.name,
      description: roadmap.description,
      isDefault: roadmap.isDefault || false,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Get a roadmap by ID.
   */
  async getRoadmap(id: string): Promise<Roadmap | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoRoadmaps)
      .where(eq(pmoRoadmaps.id, id))
      .get()

    if (!row) return null
    return this.rowToRoadmap(row)
  }

  /**
   * List roadmaps with optional filters.
   */
  async listRoadmaps(filter?: RoadmapFilter): Promise<Roadmap[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoRoadmaps)
      .$dynamic()

    const conditions = []

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoRoadmaps.name, `%${filter.search}%`),
          like(pmoRoadmaps.description, `%${filter.search}%`)
        )
      )
    }
    if (filter?.isDefault !== undefined) {
      conditions.push(eq(pmoRoadmaps.isDefault, filter.isDefault))
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(desc(pmoRoadmaps.isDefault), asc(pmoRoadmaps.name))
      .all()

    return rows.map((row: any) => this.rowToRoadmap(row))
  }

  /**
   * Update a roadmap.
   */
  async updateRoadmap(id: string, changes: Partial<Roadmap>): Promise<Roadmap> {
    const roadmap = await this.getRoadmap(id)
    if (!roadmap) {
      throw new PMOError('NOT_FOUND', `Roadmap not found: ${id}`)
    }

    const updates: Partial<typeof pmoRoadmaps.$inferInsert> = {}

    if (changes.name !== undefined) {
      updates.name = changes.name
    }
    if (changes.description !== undefined) {
      updates.description = changes.description || null
    }
    if (changes.isDefault !== undefined) {
      // If setting as default, unset other defaults first
      if (changes.isDefault) {
        this.ctx.drizzle
          .update(pmoRoadmaps)
          .set({ isDefault: false })
          .run()
      }
      updates.isDefault = changes.isDefault
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString()
      this.ctx.drizzle
        .update(pmoRoadmaps)
        .set(updates)
        .where(eq(pmoRoadmaps.id, id))
        .run()
    }

    return (await this.getRoadmap(id))!
  }

  /**
   * Delete a roadmap.
   */
  async deleteRoadmap(id: string): Promise<void> {
    const roadmap = await this.getRoadmap(id)
    if (!roadmap) {
      throw new PMOError('NOT_FOUND', `Roadmap not found: ${id}`)
    }

    // Delete roadmap (cascades to roadmap_projects)
    this.ctx.drizzle
      .delete(pmoRoadmaps)
      .where(eq(pmoRoadmaps.id, id))
      .run()
  }

  /**
   * Get the default roadmap.
   */
  async getDefaultRoadmap(): Promise<Roadmap | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoRoadmaps)
      .where(eq(pmoRoadmaps.isDefault, true))
      .limit(1)
      .get()

    if (!row) return null
    return this.rowToRoadmap(row)
  }

  /**
   * Set a roadmap as the default.
   */
  async setDefaultRoadmap(id: string): Promise<Roadmap> {
    return this.updateRoadmap(id, { isDefault: true })
  }

  // ===== Roadmap Projects =====

  /**
   * List projects in a roadmap, ordered by position.
   */
  async listRoadmapProjects(roadmapId: string): Promise<Project[]> {
    const rows = this.ctx.drizzle
      .select({
        id: pmoProjects.id,
        name: pmoProjects.name,
        template: pmoProjects.template,
        description: pmoProjects.description,
        status: pmoProjects.status,
        phaseId: pmoProjects.phaseId,
        workflowId: pmoProjects.workflowId,
        isArchived: pmoProjects.isArchived,
        targetDate: pmoProjects.targetDate,
        initiativeId: pmoProjects.initiativeId,
        createdAt: pmoProjects.createdAt,
        updatedAt: pmoProjects.updatedAt,
      })
      .from(pmoProjects)
      .innerJoin(pmoRoadmapProjects, eq(pmoProjects.id, pmoRoadmapProjects.projectId))
      .where(eq(pmoRoadmapProjects.roadmapId, roadmapId))
      .orderBy(asc(pmoRoadmapProjects.position))
      .all()

    return rows.map((row: any) => this.rowToProject(row))
  }

  /**
   * Add a project to a roadmap.
   */
  async addProjectToRoadmap(roadmapId: string, projectId: string, position?: number): Promise<RoadmapProject> {
    // Verify roadmap exists
    const roadmap = await this.getRoadmap(roadmapId)
    if (!roadmap) {
      throw new PMOError('NOT_FOUND', `Roadmap not found: ${roadmapId}`)
    }

    // Check if project is already in roadmap
    const existing = this.ctx.drizzle
      .select()
      .from(pmoRoadmapProjects)
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        eq(pmoRoadmapProjects.projectId, projectId)
      ))
      .get()

    if (existing) {
      throw new PMOError('CONFLICT', `Project ${projectId} is already in roadmap ${roadmapId}`)
    }

    // Get next position if not provided
    if (position === undefined) {
      const maxPosResult = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoRoadmapProjects.position}), -1)` })
        .from(pmoRoadmapProjects)
        .where(eq(pmoRoadmapProjects.roadmapId, roadmapId))
        .get()
      position = (maxPosResult?.maxPos ?? -1) + 1
    } else {
      // Shift existing projects at or after this position
      this.ctx.drizzle
        .update(pmoRoadmapProjects)
        .set({ position: sql`${pmoRoadmapProjects.position} + 1` })
        .where(and(
          eq(pmoRoadmapProjects.roadmapId, roadmapId),
          gte(pmoRoadmapProjects.position, position)
        ))
        .run()
    }

    const now = new Date().toISOString()

    this.ctx.drizzle.insert(pmoRoadmapProjects).values({
      roadmapId,
      projectId,
      position,
      createdAt: now,
    }).run()

    // Update roadmap timestamp
    this.ctx.drizzle
      .update(pmoRoadmaps)
      .set({ updatedAt: now })
      .where(eq(pmoRoadmaps.id, roadmapId))
      .run()

    return {
      roadmapId,
      projectId,
      position: position!,
      createdAt: new Date(now),
    }
  }

  /**
   * Remove a project from a roadmap.
   */
  async removeProjectFromRoadmap(roadmapId: string, projectId: string): Promise<void> {
    // Get current position for reordering
    const current = this.ctx.drizzle
      .select({ position: pmoRoadmapProjects.position })
      .from(pmoRoadmapProjects)
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        eq(pmoRoadmapProjects.projectId, projectId)
      ))
      .get()

    if (!current) {
      throw new PMOError('NOT_FOUND', `Project ${projectId} not in roadmap ${roadmapId}`)
    }

    // Delete the association
    this.ctx.drizzle
      .delete(pmoRoadmapProjects)
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        eq(pmoRoadmapProjects.projectId, projectId)
      ))
      .run()

    // Reorder remaining projects to fill the gap
    this.ctx.drizzle
      .update(pmoRoadmapProjects)
      .set({ position: sql`${pmoRoadmapProjects.position} - 1` })
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        gt(pmoRoadmapProjects.position, current.position)
      ))
      .run()

    // Update roadmap timestamp
    this.ctx.drizzle
      .update(pmoRoadmaps)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(pmoRoadmaps.id, roadmapId))
      .run()
  }

  /**
   * Reorder a project within a roadmap.
   */
  async reorderRoadmapProject(roadmapId: string, projectId: string, newPosition: number): Promise<RoadmapProject> {
    // Get current position
    const current = this.ctx.drizzle
      .select({
        position: pmoRoadmapProjects.position,
        createdAt: pmoRoadmapProjects.createdAt,
      })
      .from(pmoRoadmapProjects)
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        eq(pmoRoadmapProjects.projectId, projectId)
      ))
      .get()

    if (!current) {
      throw new PMOError('NOT_FOUND', `Project ${projectId} not in roadmap ${roadmapId}`)
    }

    const oldPosition = current.position
    if (oldPosition === newPosition) {
      return {
        roadmapId,
        projectId,
        position: newPosition,
        createdAt: new Date(current.createdAt!),
      }
    }

    // Shift positions
    if (newPosition < oldPosition) {
      // Moving up: increment positions in between
      this.ctx.drizzle
        .update(pmoRoadmapProjects)
        .set({ position: sql`${pmoRoadmapProjects.position} + 1` })
        .where(and(
          eq(pmoRoadmapProjects.roadmapId, roadmapId),
          gte(pmoRoadmapProjects.position, newPosition),
          lt(pmoRoadmapProjects.position, oldPosition)
        ))
        .run()
    } else {
      // Moving down: decrement positions in between
      this.ctx.drizzle
        .update(pmoRoadmapProjects)
        .set({ position: sql`${pmoRoadmapProjects.position} - 1` })
        .where(and(
          eq(pmoRoadmapProjects.roadmapId, roadmapId),
          gt(pmoRoadmapProjects.position, oldPosition),
          lte(pmoRoadmapProjects.position, newPosition)
        ))
        .run()
    }

    // Update the target project's position
    this.ctx.drizzle
      .update(pmoRoadmapProjects)
      .set({ position: newPosition })
      .where(and(
        eq(pmoRoadmapProjects.roadmapId, roadmapId),
        eq(pmoRoadmapProjects.projectId, projectId)
      ))
      .run()

    // Update roadmap timestamp
    this.ctx.drizzle
      .update(pmoRoadmaps)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(pmoRoadmaps.id, roadmapId))
      .run()

    return {
      roadmapId,
      projectId,
      position: newPosition,
      createdAt: new Date(current.createdAt!),
    }
  }

  /**
   * Get all roadmaps that contain a project.
   */
  async getRoadmapsForProject(projectId: string): Promise<Roadmap[]> {
    const rows = this.ctx.drizzle
      .select({
        id: pmoRoadmaps.id,
        name: pmoRoadmaps.name,
        description: pmoRoadmaps.description,
        isDefault: pmoRoadmaps.isDefault,
        createdAt: pmoRoadmaps.createdAt,
        updatedAt: pmoRoadmaps.updatedAt,
      })
      .from(pmoRoadmaps)
      .innerJoin(pmoRoadmapProjects, eq(pmoRoadmaps.id, pmoRoadmapProjects.roadmapId))
      .where(eq(pmoRoadmapProjects.projectId, projectId))
      .orderBy(asc(pmoRoadmaps.name))
      .all()

    return rows.map((row: any) => this.rowToRoadmap(row))
  }

  // ===== Helpers =====

  private rowToRoadmap(row: {
    id: string
    name: string
    description: string | null
    isDefault: boolean | null
    createdAt: string | null
    updatedAt: string | null
  }): Roadmap {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.isDefault ?? false,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }
  }

  private rowToProject(row: {
    id: string
    name: string
    template: string | null
    description: string | null
    status: string
    phaseId: string | null
    workflowId: string | null
    isArchived: boolean | null
    targetDate: string | null
    initiativeId: string | null
    createdAt: string | null
    updatedAt: string | null
  }): Project {
    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phaseId || undefined,
      workflowId: row.workflowId || undefined,
      isArchived: row.isArchived ?? false,
      targetDate: row.targetDate ? new Date(row.targetDate) : undefined,
      initiativeId: row.initiativeId || undefined,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }
  }
}
