/**
 * Agent profile operations.
 */

import { PMO_TABLES } from '../schema.js'
import { AgentProfile, AgentProfileFilter, MCPServerConfig, PMOError } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, AgentProfileRow } from './types.js'

const T = PMO_TABLES

export class ProfileStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List agent profiles.
   */
  async listProfiles(filter?: AgentProfileFilter): Promise<AgentProfile[]> {
    let sql = `SELECT * FROM ${T.agent_profiles}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY name ASC'

    const rows = this.ctx.db.prepare(sql).all(...params) as AgentProfileRow[]

    return rows.map((row) => this.rowToProfile(row))
  }

  /**
   * Get an agent profile by ID.
   */
  async getProfile(id: string): Promise<AgentProfile | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.agent_profiles} WHERE id = ?`).get(
      id
    ) as AgentProfileRow | undefined

    if (!row) return null

    return this.rowToProfile(row)
  }

  /**
   * Create a new agent profile.
   */
  async createProfile(profile: Partial<AgentProfile>): Promise<AgentProfile> {
    if (!profile.name) {
      throw new PMOError('INVALID', 'Profile name is required')
    }

    const id = profile.id || slugify(profile.name)

    // Check for duplicate name
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.agent_profiles} WHERE LOWER(name) = LOWER(?)
    `).get(profile.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Profile with name "${profile.name}" already exists`)
    }

    const now = new Date().toISOString()

    this.ctx.db.prepare(`
      INSERT INTO ${T.agent_profiles} (id, name, description, start_hook, end_hook, system_prompt, repos_json, mcp_servers_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      profile.name,
      profile.description || null,
      profile.startHook || null,
      profile.endHook || null,
      profile.systemPrompt || null,
      profile.repos ? JSON.stringify(profile.repos) : null,
      profile.mcpServers ? JSON.stringify(profile.mcpServers) : null,
      now,
      now
    )

    return {
      id,
      name: profile.name,
      description: profile.description,
      startHook: profile.startHook,
      endHook: profile.endHook,
      systemPrompt: profile.systemPrompt,
      repos: profile.repos,
      mcpServers: profile.mcpServers,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Update an agent profile.
   */
  async updateProfile(id: string, changes: Partial<AgentProfile>): Promise<AgentProfile> {
    const existing = await this.getProfile(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Profile not found: ${id}`)
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.ctx.db.prepare(`
        SELECT id FROM ${T.agent_profiles} WHERE LOWER(name) = LOWER(?) AND id != ?
      `).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Profile "${changes.name}" already exists`)
      }
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
    if (changes.startHook !== undefined) {
      updates.push('start_hook = ?')
      params.push(changes.startHook || null)
    }
    if (changes.endHook !== undefined) {
      updates.push('end_hook = ?')
      params.push(changes.endHook || null)
    }
    if (changes.systemPrompt !== undefined) {
      updates.push('system_prompt = ?')
      params.push(changes.systemPrompt || null)
    }
    if (changes.repos !== undefined) {
      updates.push('repos_json = ?')
      params.push(changes.repos ? JSON.stringify(changes.repos) : null)
    }
    if (changes.mcpServers !== undefined) {
      updates.push('mcp_servers_json = ?')
      params.push(changes.mcpServers ? JSON.stringify(changes.mcpServers) : null)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      params.push(id)
      this.ctx.db.prepare(`UPDATE ${T.agent_profiles} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getProfile(id))!
  }

  /**
   * Delete an agent profile.
   */
  async deleteProfile(id: string): Promise<void> {
    const existing = await this.getProfile(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Profile not found: ${id}`)
    }

    this.ctx.db.prepare(`DELETE FROM ${T.agent_profiles} WHERE id = ?`).run(id)
  }

  private rowToProfile(row: AgentProfileRow): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      startHook: row.start_hook || undefined,
      endHook: row.end_hook || undefined,
      systemPrompt: row.system_prompt || undefined,
      repos: row.repos_json ? (JSON.parse(row.repos_json) as string[]) : undefined,
      mcpServers: row.mcp_servers_json ? (JSON.parse(row.mcp_servers_json) as MCPServerConfig[]) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}
