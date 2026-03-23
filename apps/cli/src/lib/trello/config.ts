/**
 * Trello Configuration Storage
 *
 * Stores Trello credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'

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

/**
 * Check if Trello is configured.
 */
export function isTrelloConfigured(db: Database.Database): boolean {
  const settings = new SettingsStore(db)
  const hasDbConfig = settings.has(TRELLO_CONFIG_KEYS.apiKey)
    && settings.has(TRELLO_CONFIG_KEYS.apiToken)
  if (hasDbConfig) return true

  const hasEnvKey = !!(process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY)
  const hasEnvToken = !!(process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN)
  return hasEnvKey && hasEnvToken
}

/**
 * Load Trello configuration from the database + environment.
 */
export function loadTrelloConfig(db: Database.Database): TrelloConfig | null {
  const settings = new SettingsStore(db)
  const apiKey = settings.get(TRELLO_CONFIG_KEYS.apiKey)
    || process.env.PRLT_TRELLO_API_KEY
    || process.env.TRELLO_API_KEY

  const apiToken = settings.get(TRELLO_CONFIG_KEYS.apiToken)
    || process.env.PRLT_TRELLO_API_TOKEN
    || process.env.TRELLO_API_TOKEN

  if (!apiKey || !apiToken) return null

  return {
    apiKey,
    apiToken,
    boardId: settings.get(TRELLO_CONFIG_KEYS.boardId)
      || process.env.PRLT_TRELLO_BOARD_ID
      || undefined,
    boardName: settings.get(TRELLO_CONFIG_KEYS.boardName) || undefined,
  }
}

/**
 * Save Trello configuration to the database.
 */
export function saveTrelloConfig(db: Database.Database, config: TrelloConfig): void {
  const settings = new SettingsStore(db)
  settings.set(TRELLO_CONFIG_KEYS.apiKey, config.apiKey)
  settings.set(TRELLO_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.boardId) {
    settings.set(TRELLO_CONFIG_KEYS.boardId, config.boardId)
  }
  if (config.boardName) {
    settings.set(TRELLO_CONFIG_KEYS.boardName, config.boardName)
  }
}

export function saveTrelloApiKey(db: Database.Database, apiKey: string): void {
  new SettingsStore(db).set(TRELLO_CONFIG_KEYS.apiKey, apiKey)
}

export function saveTrelloApiToken(db: Database.Database, apiToken: string): void {
  new SettingsStore(db).set(TRELLO_CONFIG_KEYS.apiToken, apiToken)
}

export function saveTrelloBoard(db: Database.Database, boardId: string, boardName: string): void {
  const settings = new SettingsStore(db)
  settings.set(TRELLO_CONFIG_KEYS.boardId, boardId)
  settings.set(TRELLO_CONFIG_KEYS.boardName, boardName)
}

export function clearTrelloConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(TRELLO_CONFIG_KEYS)) {
    settings.delete(key)
  }
}

export function getTrelloApiKey(db: Database.Database): string | null {
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

  const envKey = process.env.PRLT_TRELLO_API_KEY || process.env.TRELLO_API_KEY
  if (envKey) return envKey

  return new SettingsStore(db).get(TRELLO_CONFIG_KEYS.apiKey)
}

export function getTrelloApiToken(db: Database.Database): string | null {
  const envToken = process.env.PRLT_TRELLO_API_TOKEN || process.env.TRELLO_API_TOKEN
  if (envToken) return envToken

  return new SettingsStore(db).get(TRELLO_CONFIG_KEYS.apiToken)
}
