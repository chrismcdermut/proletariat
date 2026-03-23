/**
 * Settings Store
 *
 * Centralized access to the workspace_settings key-value table.
 * Replaces the duplicated getSetting/setSetting/deleteSetting helpers
 * that were copied across linear/config.ts, jira/config.ts, etc.
 *
 * All workspace settings access should go through this store.
 */

import type { DatabaseDriver } from './driver.js'
import { SqliteDatabase } from './sqlite.js'
import { wrapDatabase } from './driver.js'

const SETTINGS_TABLE = 'workspace_settings'

/**
 * Provides CRUD access to the workspace_settings key-value table.
 *
 * Usage:
 * ```typescript
 * const settings = new SettingsStore(driver)
 * settings.set('linear.api_key', 'sk-...')
 * const key = settings.get('linear.api_key')
 * settings.delete('linear.api_key')
 * ```
 */
export class SettingsStore {
  private driver: DatabaseDriver

  /**
   * Create a SettingsStore.
   * Accepts either a DatabaseDriver or a raw better-sqlite3 Database
   * (for backward compatibility during migration).
   */
  constructor(driverOrDb: DatabaseDriver | SqliteDatabase) {
    if (driverOrDb instanceof SqliteDatabase) {
      this.driver = wrapDatabase(driverOrDb)
    } else {
      this.driver = driverOrDb
    }
  }

  /**
   * Get a setting value by key. Returns null if not found.
   */
  get(key: string): string | null {
    const row = this.driver
      .prepare<{ value: string }>(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
      .get(key)
    return row?.value ?? null
  }

  /**
   * Set a setting value. Inserts or updates (upserts) the key.
   */
  set(key: string, value: string): void {
    this.driver.prepare(`
      INSERT INTO ${SETTINGS_TABLE} (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  /**
   * Delete a setting by key.
   */
  delete(key: string): void {
    this.driver.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
  }

  /**
   * Check if a setting exists.
   */
  has(key: string): boolean {
    return this.get(key) !== null
  }

  /**
   * Get all settings matching a key prefix.
   * E.g., getByPrefix('linear.') returns all Linear settings.
   */
  getByPrefix(prefix: string): Array<{ key: string; value: string }> {
    return this.driver
      .prepare<{ key: string; value: string }>(`SELECT key, value FROM ${SETTINGS_TABLE} WHERE key LIKE ?`)
      .all(`${prefix}%`)
  }
}

/**
 * Create a SettingsStore from a raw better-sqlite3 Database.
 * Convenience function for backward compatibility.
 */
export function createSettingsStore(db: SqliteDatabase): SettingsStore {
  return new SettingsStore(db)
}
