/**
 * Trello Configuration Storage
 *
 * Stores Trello credentials and preferences in the workspace_settings table.
 * Mirrors the Shortcut/Asana config module pattern.
 */

import Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

/** Default environment variable name used as apiKeyRef for Trello provider sources. */
export const TRELLO_API_KEY_ENV_VAR = 'PRLT_TRELLO_API_KEY'

/** Default environment variable name for Trello API token. */
export const TRELLO_API_TOKEN_ENV_VAR = 'PRLT_TRELLO_API_TOKEN'

const TRELLO_CONFIG_KEYS = {
  apiKey: 'trello.api_key',
  apiToken: 'trello.api_token',
  boardId: 'trello.board_id',
  boardName: 'trello.board_name',
} as const

export interface TrelloConfig {
  apiKey: string
  apiToken: string
  boardId?: string
  boardName?: string
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
 * Check if Trello is configured (both API key and token are available via any resolution path).
 */
export function isTrelloConfigured(db: Database.Database): boolean {
  return getTrelloApiKey(db) !== null && getTrelloApiToken(db) !== null
}

/**
 * Load Trello configuration by resolving the API key and token through the
 * provider-sources chain and legacy fallbacks.
 * Returns null if either credential cannot be resolved.
 */
export function loadTrelloConfig(db: Database.Database): TrelloConfig | null {
  const apiKey = getTrelloApiKey(db)
  const apiToken = getTrelloApiToken(db)
  if (!apiKey || !apiToken) return null

  return {
    apiKey,
    apiToken,
    boardId: getSetting(db, TRELLO_CONFIG_KEYS.boardId)
      || process.env.PRLT_TRELLO_BOARD_ID
      || undefined,
    boardName: getSetting(db, TRELLO_CONFIG_KEYS.boardName) || undefined,
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
  if (config.boardName) {
    setSetting(db, TRELLO_CONFIG_KEYS.boardName, config.boardName)
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
 * Save the Trello board.
 */
export function saveTrelloBoard(db: Database.Database, boardId: string, boardName: string): void {
  setSetting(db, TRELLO_CONFIG_KEYS.boardId, boardId)
  setSetting(db, TRELLO_CONFIG_KEYS.boardName, boardName)
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
  // 1. Try provider sources (resolves apiKeyRef → trello.api_key)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'trello') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY
  if (envKey) return envKey

  // 3. Legacy: stored workspace setting
  return getSetting(db, TRELLO_CONFIG_KEYS.apiKey)
}

/**
 * Get the stored Trello API token using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. PRLT_TRELLO_API_TOKEN or TRELLO_API_TOKEN environment variables
 * 2. workspace_settings key 'PRLT_TRELLO_API_TOKEN' (set by connect wizard)
 * 3. Legacy: workspace_settings key 'trello.api_token'
 */
export function getTrelloApiToken(db: Database.Database): string | null {
  // 1. Environment variables
  const envToken = process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN
  if (envToken) return envToken

  // 2. New: stored under env var name by connect wizard
  const newDbToken = getSetting(db, TRELLO_API_TOKEN_ENV_VAR)
  if (newDbToken) return newDbToken

  // 3. Legacy: stored workspace setting
  return getSetting(db, TRELLO_CONFIG_KEYS.apiToken)
}
