/**
 * Roadmap operations for PMO.
 * Roadmaps are curated collections of projects for documentation/visualization.
 */

import { PMO_TABLES } from '../schema.js'
import { Roadmap, RoadmapProject, RoadmapFilter, PMOError, Project } from '../types.js'
import { StorageContext, RoadmapRow, RoadmapProjectRow, ProjectRow } from './types.js'

const T = PMO_TABLES

export class RoadmapStorage {
  constructor(private ctx: StorageContext) {}

  // ===== Roadmap CRUD =====

  /**
   * Create a new roadmap.
   */
  async createRoadmap(roadmap: Partial<Roadmap> & { name: string }): Promise<Roadmap> {
    const id = roadmap.id || `roadmap-${Date.now()}`
    const now = Date.now()

    // If setting as default, unset other defaults first
    if (roadmap.isDefault) {
      this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET is_default = 0`).run()
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.roadmaps} (id, name, description, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roadmap.name,
      roadmap.description || null,
      roadmap.isDefault ? 1 : 0,
      now,
      now
    )

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
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.roadmaps} WHERE id = ?
    `).get(id) as RoadmapRow | undefined

    if (!row) return null
    return this.rowToRoadmap(row)
  }

  /**
   * List roadmaps with optional filters.
   */
  async listRoadmaps(filter?: RoadmapFilter): Promise<Roadmap[]> {
    let query = `SELECT * FROM ${T.roadmaps} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.search) {
      query += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.isDefault !== undefined) {
      query += ' AND is_default = ?'
      params.push(filter.isDefault ? 1 : 0)
    }

    query += ' ORDER BY is_default DESC, name ASC'

    const rows = this.ctx.db.prepare(query).all(...params) as RoadmapRow[]
    return rows.map(row => this.rowToRoadmap(row))
  }

  /**
   * Update a roadmap.
   */
  async updateRoadmap(id: string, changes: Partial<Roadmap>): Promise<Roadmap> {
    const roadmap = await this.getRoadmap(id)
    if (!roadmap) {
      throw new PMOError('NOT_FOUND', `Roadmap not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.isDefault !== undefined) {
      // If setting as default, unset other defaults first
      if (changes.isDefault) {
        this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET is_default = 0`).run()
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
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
    this.ctx.db.prepare(`DELETE FROM ${T.roadmaps} WHERE id = ?`).run(id)
  }

  /**
   * Get the default roadmap.
   */
  async getDefaultRoadmap(): Promise<Roadmap | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.roadmaps} WHERE is_default = 1 LIMIT 1
    `).get() as RoadmapRow | undefined

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
    const rows = this.ctx.db.prepare(`
      SELECT p.* FROM ${T.projects} p
      JOIN ${T.roadmap_projects} rp ON p.id = rp.project_id
      WHERE rp.roadmap_id = ?
      ORDER BY rp.position ASC
    `).all(roadmapId) as ProjectRow[]

    return rows.map(row => this.rowToProject(row))
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
    const existing = this.ctx.db.prepare(`
      SELECT * FROM ${T.roadmap_projects} WHERE roadmap_id = ? AND project_id = ?
    `).get(roadmapId, projectId) as RoadmapProjectRow | undefined

    if (existing) {
      throw new PMOError('CONFLICT', `Project ${projectId} is already in roadmap ${roadmapId}`)
    }

    // Get next position if not provided
    if (position === undefined) {
      const maxPos = this.ctx.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.roadmap_projects} WHERE roadmap_id = ?
      `).get(roadmapId) as { max_pos: number }
      position = maxPos.max_pos + 1
    } else {
      // Shift existing projects at or after this position
      this.ctx.db.prepare(`
        UPDATE ${T.roadmap_projects}
        SET position = position + 1
        WHERE roadmap_id = ? AND position >= ?
      `).run(roadmapId, position)
    }

    const now = Date.now()

    this.ctx.db.prepare(`
      INSERT INTO ${T.roadmap_projects} (roadmap_id, project_id, position, created_at)
      VALUES (?, ?, ?, ?)
    `).run(roadmapId, projectId, position, now)

    // Update roadmap timestamp
    this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET updated_at = ? WHERE id = ?`).run(now, roadmapId)

    return {
      roadmapId,
      projectId,
      position,
      createdAt: new Date(now),
    }
  }

  /**
   * Remove a project from a roadmap.
   */
  async removeProjectFromRoadmap(roadmapId: string, projectId: string): Promise<void> {
    // Get current position for reordering
    const current = this.ctx.db.prepare(`
      SELECT position FROM ${T.roadmap_projects} WHERE roadmap_id = ? AND project_id = ?
    `).get(roadmapId, projectId) as { position: number } | undefined

    if (!current) {
      throw new PMOError('NOT_FOUND', `Project ${projectId} not in roadmap ${roadmapId}`)
    }

    // Delete the association
    this.ctx.db.prepare(`
      DELETE FROM ${T.roadmap_projects} WHERE roadmap_id = ? AND project_id = ?
    `).run(roadmapId, projectId)

    // Reorder remaining projects to fill the gap
    this.ctx.db.prepare(`
      UPDATE ${T.roadmap_projects}
      SET position = position - 1
      WHERE roadmap_id = ? AND position > ?
    `).run(roadmapId, current.position)

    // Update roadmap timestamp
    this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET updated_at = ? WHERE id = ?`).run(Date.now(), roadmapId)
  }

  /**
   * Reorder a project within a roadmap.
   */
  async reorderRoadmapProject(roadmapId: string, projectId: string, newPosition: number): Promise<RoadmapProject> {
    // Get current position
    const current = this.ctx.db.prepare(`
      SELECT position, created_at FROM ${T.roadmap_projects} WHERE roadmap_id = ? AND project_id = ?
    `).get(roadmapId, projectId) as { position: number; created_at: string } | undefined

    if (!current) {
      throw new PMOError('NOT_FOUND', `Project ${projectId} not in roadmap ${roadmapId}`)
    }

    const oldPosition = current.position
    if (oldPosition === newPosition) {
      return {
        roadmapId,
        projectId,
        position: newPosition,
        createdAt: new Date(current.created_at),
      }
    }

    // Shift positions (same pattern as EpicStorage.reorderEpic)
    if (newPosition < oldPosition) {
      // Moving up: increment positions in between
      this.ctx.db.prepare(`
        UPDATE ${T.roadmap_projects}
        SET position = position + 1
        WHERE roadmap_id = ? AND position >= ? AND position < ?
      `).run(roadmapId, newPosition, oldPosition)
    } else {
      // Moving down: decrement positions in between
      this.ctx.db.prepare(`
        UPDATE ${T.roadmap_projects}
        SET position = position - 1
        WHERE roadmap_id = ? AND position > ? AND position <= ?
      `).run(roadmapId, oldPosition, newPosition)
    }

    // Update the target project's position
    this.ctx.db.prepare(`
      UPDATE ${T.roadmap_projects}
      SET position = ?
      WHERE roadmap_id = ? AND project_id = ?
    `).run(newPosition, roadmapId, projectId)

    // Update roadmap timestamp
    this.ctx.db.prepare(`UPDATE ${T.roadmaps} SET updated_at = ? WHERE id = ?`).run(Date.now(), roadmapId)

    return {
      roadmapId,
      projectId,
      position: newPosition,
      createdAt: new Date(current.created_at),
    }
  }

  /**
   * Get all roadmaps that contain a project.
   */
  async getRoadmapsForProject(projectId: string): Promise<Roadmap[]> {
    const rows = this.ctx.db.prepare(`
      SELECT r.* FROM ${T.roadmaps} r
      JOIN ${T.roadmap_projects} rp ON r.id = rp.roadmap_id
      WHERE rp.project_id = ?
      ORDER BY r.name ASC
    `).all(projectId) as RoadmapRow[]

    return rows.map(row => this.rowToRoadmap(row))
  }

  // ===== Helpers =====

  private rowToRoadmap(row: RoadmapRow): Roadmap {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      workflowId: row.workflow_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      initiativeId: row.initiative_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}
