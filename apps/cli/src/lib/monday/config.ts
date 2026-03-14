import Database from 'better-sqlite3'
import type { MondayConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

/** Default environment variable name used as apiKeyRef for Monday provider sources. */
export const MONDAY_API_TOKEN_ENV_VAR = 'PRLT_MONDAY_API_TOKEN'

const MONDAY_CONFIG_KEYS = {
  apiToken: 'monday.api_token',
  boardId: 'monday.board_id',
  boardName: 'monday.board_name',
  accountName: 'monday.account_name',
} as const

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
 * Check if Monday is configured (API token is available via any resolution path).
 */
export function isMondayConfigured(db: Database.Database): boolean {
  return getMondayApiToken(db) !== null
}

/**
 * Load Monday configuration by resolving the API token through the provider-sources
 * chain (provider source apiKeyRef → legacy env vars → legacy DB key).
 * Returns null if no API token can be resolved.
 */
export function loadMondayConfig(db: Database.Database): MondayConfig | null {
  const apiToken = getMondayApiToken(db)
  if (!apiToken) return null

  return {
    apiToken,
    boardId: getSetting(db, MONDAY_CONFIG_KEYS.boardId) ?? undefined,
    boardName: getSetting(db, MONDAY_CONFIG_KEYS.boardName) ?? undefined,
    accountName: getSetting(db, MONDAY_CONFIG_KEYS.accountName) ?? undefined,
  }
}

export function saveMondayApiToken(db: Database.Database, apiToken: string): void {
  setSetting(db, MONDAY_CONFIG_KEYS.apiToken, apiToken)
}

export function saveMondayBoard(db: Database.Database, boardId: string, boardName: string): void {
  setSetting(db, MONDAY_CONFIG_KEYS.boardId, boardId)
  setSetting(db, MONDAY_CONFIG_KEYS.boardName, boardName)
}

export function saveMondayAccountName(db: Database.Database, accountName: string): void {
  setSetting(db, MONDAY_CONFIG_KEYS.accountName, accountName)
}

export function clearMondayConfig(db: Database.Database): void {
  for (const key of Object.values(MONDAY_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}

export function getMondayApiToken(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'monday') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envToken = process.env.PRLT_MONDAY_API_TOKEN || process.env.MONDAY_API_TOKEN
  if (envToken) return envToken

  // 3. Legacy: stored workspace setting
  return getSetting(db, MONDAY_CONFIG_KEYS.apiToken)
}

export function getMondayBoardId(db: Database.Database): string | null {
  const envBoardId = process.env.PRLT_MONDAY_BOARD_ID || process.env.MONDAY_BOARD_ID
  if (envBoardId) return envBoardId

  return getSetting(db, MONDAY_CONFIG_KEYS.boardId)
}
