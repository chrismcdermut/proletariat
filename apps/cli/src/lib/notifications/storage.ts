/**
 * Notification Storage
 *
 * CRUD operations for notification providers and rules in the workspace database.
 * Follows the WorkHookStorage pattern.
 */

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  NotificationProvider,
  NotificationProviderRow,
  NotificationProviderType,
  NotificationRule,
  NotificationRuleRow,
  NotificationEvent,
  ProviderConfig,
} from './types.js'

// =============================================================================
// Row Converters
// =============================================================================

function providerRowToModel(row: NotificationProviderRow): NotificationProvider {
  let config: ProviderConfig = {} as ProviderConfig
  try {
    config = JSON.parse(row.config) as ProviderConfig
  } catch {
    // Invalid JSON — use empty config
  }

  return {
    id: row.id,
    type: row.type as NotificationProviderType,
    name: row.name,
    config,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function ruleRowToModel(row: NotificationRuleRow): NotificationRule {
  return {
    id: row.id,
    event: row.event as NotificationEvent,
    providerId: row.provider_id,
    priority: row.priority,
    escalationDelaySeconds: row.escalation_delay_seconds,
    escalationGroup: row.escalation_group,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  }
}

// =============================================================================
// NotificationStorage
// =============================================================================

export class NotificationStorage {
  constructor(private db: Database.Database) {}

  // ─── Provider CRUD ──────────────────────────────────────────

  /** List all providers, optionally filtered by type or enabled status. */
  listProviders(options?: { type?: NotificationProviderType; enabled?: boolean }): NotificationProvider[] {
    const params: unknown[] = []
    let where = ' WHERE 1=1'

    if (options?.type) {
      where += ' AND type = ?'
      params.push(options.type)
    }
    if (options?.enabled !== undefined) {
      where += ' AND enabled = ?'
      params.push(options.enabled ? 1 : 0)
    }

    const sql = `SELECT * FROM notification_providers${where} ORDER BY created_at ASC`
    const rows = this.db.prepare(sql).all(...params) as NotificationProviderRow[]
    return rows.map(providerRowToModel)
  }

  /** Get a single provider by ID. */
  getProviderById(id: string): NotificationProvider | null {
    const row = this.db.prepare('SELECT * FROM notification_providers WHERE id = ?').get(id) as NotificationProviderRow | undefined
    return row ? providerRowToModel(row) : null
  }

  /** Get a single provider by name. */
  getProviderByName(name: string): NotificationProvider | null {
    const row = this.db.prepare('SELECT * FROM notification_providers WHERE name = ?').get(name) as NotificationProviderRow | undefined
    return row ? providerRowToModel(row) : null
  }

  /** Create a new notification provider. */
  createProvider(params: {
    type: NotificationProviderType
    name: string
    config: ProviderConfig
  }): NotificationProvider {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO notification_providers (id, type, name, config)
      VALUES (?, ?, ?, ?)
    `).run(id, params.type, params.name, JSON.stringify(params.config))

    return this.getProviderById(id)!
  }

  /** Update a provider's configuration. */
  updateProvider(id: string, updates: { name?: string; config?: ProviderConfig; enabled?: boolean }): boolean {
    const sets: string[] = []
    const params: unknown[] = []

    if (updates.name !== undefined) {
      sets.push('name = ?')
      params.push(updates.name)
    }
    if (updates.config !== undefined) {
      sets.push('config = ?')
      params.push(JSON.stringify(updates.config))
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?')
      params.push(updates.enabled ? 1 : 0)
    }

    if (sets.length === 0) return false

    sets.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)

    const result = this.db.prepare(`UPDATE notification_providers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return result.changes > 0
  }

  /** Delete a provider by ID (cascades to rules). */
  deleteProvider(id: string): boolean {
    const result = this.db.prepare('DELETE FROM notification_providers WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ─── Rule CRUD ──────────────────────────────────────────────

  /** List all rules, optionally filtered by event or provider. */
  listRules(options?: { event?: string; providerId?: string; enabled?: boolean }): NotificationRule[] {
    const params: unknown[] = []
    let where = ' WHERE 1=1'

    if (options?.event) {
      where += ' AND event = ?'
      params.push(options.event)
    }
    if (options?.providerId) {
      where += ' AND provider_id = ?'
      params.push(options.providerId)
    }
    if (options?.enabled !== undefined) {
      where += ' AND enabled = ?'
      params.push(options.enabled ? 1 : 0)
    }

    const sql = `SELECT * FROM notification_rules${where} ORDER BY priority ASC, created_at ASC`
    const rows = this.db.prepare(sql).all(...params) as NotificationRuleRow[]
    return rows.map(ruleRowToModel)
  }

  /** Get a single rule by ID. */
  getRuleById(id: string): NotificationRule | null {
    const row = this.db.prepare('SELECT * FROM notification_rules WHERE id = ?').get(id) as NotificationRuleRow | undefined
    return row ? ruleRowToModel(row) : null
  }

  /** Create a new notification rule. */
  createRule(params: {
    event: NotificationEvent
    providerId: string
    priority?: number
    escalationDelaySeconds?: number | null
    escalationGroup?: string | null
  }): NotificationRule {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO notification_rules (id, event, provider_id, priority, escalation_delay_seconds, escalation_group)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.event,
      params.providerId,
      params.priority ?? 0,
      params.escalationDelaySeconds ?? null,
      params.escalationGroup ?? null,
    )

    return this.getRuleById(id)!
  }

  /** Delete a rule by ID. */
  deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM notification_rules WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** Enable or disable a rule. */
  setRuleEnabled(id: string, enabled: boolean): boolean {
    const result = this.db.prepare('UPDATE notification_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    return result.changes > 0
  }

  /** Get rules for an event with their providers resolved. */
  getRulesWithProviders(event: string): Array<{ rule: NotificationRule; provider: NotificationProvider }> {
    const sql = `
      SELECT r.*, p.id as p_id, p.type as p_type, p.name as p_name, p.config as p_config, p.enabled as p_enabled, p.created_at as p_created_at, p.updated_at as p_updated_at
      FROM notification_rules r
      JOIN notification_providers p ON r.provider_id = p.id
      WHERE r.event = ? AND r.enabled = 1 AND p.enabled = 1
      ORDER BY r.priority ASC, r.created_at ASC
    `

    interface JoinedRow extends NotificationRuleRow {
      p_id: string
      p_type: string
      p_name: string
      p_config: string
      p_enabled: number
      p_created_at: string
      p_updated_at: string
    }

    const rows = this.db.prepare(sql).all(event) as JoinedRow[]
    return rows.map(row => ({
      rule: ruleRowToModel(row),
      provider: providerRowToModel({
        id: row.p_id,
        type: row.p_type,
        name: row.p_name,
        config: row.p_config,
        enabled: row.p_enabled,
        created_at: row.p_created_at,
        updated_at: row.p_updated_at,
      }),
    }))
  }
}
