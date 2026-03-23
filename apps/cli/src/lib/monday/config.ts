import type Database from 'better-sqlite3'
import type { MondayConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'

const MONDAY_CONFIG_KEYS = {
  apiToken: 'monday.api_token',
  boardId: 'monday.board_id',
  boardName: 'monday.board_name',
  accountName: 'monday.account_name',
} as const

export function isMondayConfigured(db: Database.Database): boolean {
  return new SettingsStore(db).has(MONDAY_CONFIG_KEYS.apiToken)
}

export function loadMondayConfig(db: Database.Database): MondayConfig | null {
  const settings = new SettingsStore(db)
  const apiToken = settings.get(MONDAY_CONFIG_KEYS.apiToken)
  if (!apiToken) return null

  return {
    apiToken,
    boardId: settings.get(MONDAY_CONFIG_KEYS.boardId) ?? undefined,
    boardName: settings.get(MONDAY_CONFIG_KEYS.boardName) ?? undefined,
    accountName: settings.get(MONDAY_CONFIG_KEYS.accountName) ?? undefined,
  }
}

export function saveMondayApiToken(db: Database.Database, apiToken: string): void {
  new SettingsStore(db).set(MONDAY_CONFIG_KEYS.apiToken, apiToken)
}

export function saveMondayBoard(db: Database.Database, boardId: string, boardName: string): void {
  const settings = new SettingsStore(db)
  settings.set(MONDAY_CONFIG_KEYS.boardId, boardId)
  settings.set(MONDAY_CONFIG_KEYS.boardName, boardName)
}

export function saveMondayAccountName(db: Database.Database, accountName: string): void {
  new SettingsStore(db).set(MONDAY_CONFIG_KEYS.accountName, accountName)
}

export function clearMondayConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(MONDAY_CONFIG_KEYS)) {
    settings.delete(key)
  }
}

export function getMondayApiToken(db: Database.Database): string | null {
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

  const envToken = process.env.PRLT_MONDAY_API_TOKEN || process.env.MONDAY_API_TOKEN
  if (envToken) return envToken

  return new SettingsStore(db).get(MONDAY_CONFIG_KEYS.apiToken)
}

export function getMondayBoardId(db: Database.Database): string | null {
  const envBoardId = process.env.PRLT_MONDAY_BOARD_ID || process.env.MONDAY_BOARD_ID
  if (envBoardId) return envBoardId

  return new SettingsStore(db).get(MONDAY_CONFIG_KEYS.boardId)
}
