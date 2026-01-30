/**
 * Analytics Configuration Helpers
 *
 * Functions for managing analytics settings in the workspace database.
 * Follows the same patterns as execution/config.ts for consistency.
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import inquirer from 'inquirer'
import { AnalyticsConfig, ANALYTICS_SETTINGS_KEYS } from './types.js'

const SETTINGS_TABLE = 'workspace_settings'

/**
 * Get a setting value from the database
 */
function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Set a setting value in the database
 */
function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

/**
 * Delete a setting from the database
 */
function deleteSetting(db: Database.Database, key: string): void {
  db.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
}

/**
 * Check if analytics is enabled for this workspace
 */
export function isAnalyticsEnabled(db: Database.Database): boolean {
  const value = getSetting(db, ANALYTICS_SETTINGS_KEYS.enabled)
  return value === 'true'
}

/**
 * Get the anonymous workspace UUID for analytics
 * Creates one if it doesn't exist
 */
export function getWorkspaceUUID(db: Database.Database): string {
  let uuid = getSetting(db, ANALYTICS_SETTINGS_KEYS.workspaceId)
  if (!uuid) {
    uuid = randomUUID()
    setSetting(db, ANALYTICS_SETTINGS_KEYS.workspaceId, uuid)
  }
  return uuid
}

/**
 * Get the full analytics configuration
 */
export function getAnalyticsConfig(db: Database.Database): AnalyticsConfig {
  return {
    enabled: isAnalyticsEnabled(db),
    workspaceId: getWorkspaceUUID(db),
    consentDate: getSetting(db, ANALYTICS_SETTINGS_KEYS.consentDate),
  }
}

/**
 * Enable analytics with consent timestamp
 */
export function enableAnalytics(db: Database.Database): void {
  setSetting(db, ANALYTICS_SETTINGS_KEYS.enabled, 'true')
  setSetting(db, ANALYTICS_SETTINGS_KEYS.consentDate, new Date().toISOString())
  // Ensure workspace UUID exists
  getWorkspaceUUID(db)
}

/**
 * Disable analytics
 * Preserves workspace UUID in case user re-enables later
 */
export function disableAnalytics(db: Database.Database): void {
  setSetting(db, ANALYTICS_SETTINGS_KEYS.enabled, 'false')
  deleteSetting(db, ANALYTICS_SETTINGS_KEYS.consentDate)
}

/**
 * Check if analytics preference has been set (user has made a choice)
 */
export function hasAnalyticsPreference(db: Database.Database): boolean {
  return getSetting(db, ANALYTICS_SETTINGS_KEYS.enabled) !== null
}

/**
 * Get consent date if analytics is enabled
 */
export function getConsentDate(db: Database.Database): string | null {
  return getSetting(db, ANALYTICS_SETTINGS_KEYS.consentDate)
}

/**
 * Prompt user for analytics preference during init
 * Returns true if analytics was enabled, false otherwise
 */
export async function promptAnalyticsPreference(db: Database.Database): Promise<boolean> {
  const { enableAnalytics: shouldEnable } = await inquirer.prompt([{
    type: 'list',
    name: 'enableAnalytics',
    message: 'Help improve prlt by sharing anonymous usage data?',
    choices: [
      {
        name: 'Yes - Share anonymous usage statistics (recommended)',
        value: true,
      },
      {
        name: 'No - Do not share usage data',
        value: false,
      },
    ],
    default: true,
  }])

  if (shouldEnable) {
    enableAnalytics(db)
  } else {
    disableAnalytics(db)
  }

  return shouldEnable
}
