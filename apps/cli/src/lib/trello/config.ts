/**
 * Trello Configuration Storage
 *
 * Stores Trello credentials and preferences in the workspace_settings table.
 * Mirrors the Shortcut config module pattern.
 */

import Database from 'better-sqlite3'

const SETTINGS_TABLE = 'workspace_settings'

const TRELLO_CONFIG_KEYS = {
  apiKey: 'trello.api_key',
  apiToken: 'trello.api_token',
  boardId: 'trello.board_id',
} as const

export interface TrelloConfig {
  apiKey: string
  apiToken: string
  boardId?: string
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function deleteSetting(db: Database.Database, key: string): void {
  db.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
}

/**
 * Check if Trello is configured.
 * Returns true if either:
 * - Database has trello.api_key and trello.api_token stored, OR
 * - Environment variables PRLT_TRELLO_API_KEY/TRELLO_API_KEY and PRLT_TRELLO_API_TOKEN/TRELLO_API_TOKEN are set
 */
export function isTrelloConfigured(db: Database.Database): boolean {
  const hasDbKey = getSetting(db, TRELLO_CONFIG_KEYS.apiKey) !== null
  const hasDbToken = getSetting(db, TRELLO_CONFIG_KEYS.apiToken) !== null
  if (hasDbKey && hasDbToken) return true

  const hasEnvKey = !!(process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY)
  const hasEnvToken = !!(process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN)
  return hasEnvKey && hasEnvToken
}

/**
 * Load Trello configuration from the database + environment.
 * Returns null if not configured.
 */
export function loadTrelloConfig(db: Database.Database): TrelloConfig | null {
  const apiKey = getSetting(db, TRELLO_CONFIG_KEYS.apiKey)
    || process.env.PRLT_TRELLO_API_KEY
    || process.env.TRELLO_API_KEY

  const apiToken = getSetting(db, TRELLO_CONFIG_KEYS.apiToken)
    || process.env.PRLT_TRELLO_API_TOKEN
    || process.env.TRELLO_API_TOKEN

  if (!apiKey || !apiToken) return null

  return {
    apiKey,
    apiToken,
    boardId: getSetting(db, TRELLO_CONFIG_KEYS.boardId)
      || process.env.PRLT_TRELLO_BOARD_ID
      || process.env.TRELLO_BOARD_ID
      || undefined,
  }
}

/**
 * Save Trello configuration to the database.
 */
export function saveTrelloConfig(db: Database.Database, config: TrelloConfig): void {
  setSetting(db, TRELLO_CONFIG_KEYS.apiKey, config.apiKey)
  setSetting(db, TRELLO_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.boardId) {
    setSetting(db, TRELLO_CONFIG_KEYS.boardId, config.boardId)
  }
}

/**
 * Save the Trello API key.
 */
export function saveTrelloApiKey(db: Database.Database, apiKey: string): void {
  setSetting(db, TRELLO_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the Trello API token.
 */
export function saveTrelloApiToken(db: Database.Database, apiToken: string): void {
  setSetting(db, TRELLO_CONFIG_KEYS.apiToken, apiToken)
}

/**
 * Save the Trello board ID.
 */
export function saveTrelloBoardId(db: Database.Database, boardId: string): void {
  setSetting(db, TRELLO_CONFIG_KEYS.boardId, boardId)
}

/**
 * Clear all Trello configuration from the database.
 */
export function clearTrelloConfig(db: Database.Database): void {
  for (const key of Object.values(TRELLO_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}

/**
 * Get the stored Trello API key.
 * Also checks PRLT_TRELLO_API_KEY and TRELLO_API_KEY environment variables.
 */
export function getTrelloApiKey(db: Database.Database): string | null {
  const envKey = process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY
  if (envKey) return envKey

  return getSetting(db, TRELLO_CONFIG_KEYS.apiKey)
}

/**
 * Get the stored Trello API token.
 * Also checks PRLT_TRELLO_API_TOKEN and TRELLO_API_TOKEN environment variables.
 */
export function getTrelloApiToken(db: Database.Database): string | null {
  const envToken = process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN
  if (envToken) return envToken

  return getSetting(db, TRELLO_CONFIG_KEYS.apiToken)
}
