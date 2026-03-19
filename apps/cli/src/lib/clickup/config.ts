import Database from 'better-sqlite3'
import type { ClickUpConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

const CLICKUP_CONFIG_KEYS = {
  apiKey: 'clickup.api_key',
  workspaceId: 'clickup.workspace_id',
  workspaceName: 'clickup.workspace_name',
  spaceId: 'clickup.space_id',
  spaceName: 'clickup.space_name',
  listId: 'clickup.list_id',
  listName: 'clickup.list_name',
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

export function isClickUpConfigured(db: Database.Database): boolean {
  return getSetting(db, CLICKUP_CONFIG_KEYS.apiKey) !== null
}

export function loadClickUpConfig(db: Database.Database): ClickUpConfig | null {
  const apiKey = getSetting(db, CLICKUP_CONFIG_KEYS.apiKey)
  if (!apiKey) return null

  return {
    apiKey,
    workspaceId: getSetting(db, CLICKUP_CONFIG_KEYS.workspaceId) ?? undefined,
    workspaceName: getSetting(db, CLICKUP_CONFIG_KEYS.workspaceName) ?? undefined,
    spaceId: getSetting(db, CLICKUP_CONFIG_KEYS.spaceId) ?? undefined,
    spaceName: getSetting(db, CLICKUP_CONFIG_KEYS.spaceName) ?? undefined,
    listId: getSetting(db, CLICKUP_CONFIG_KEYS.listId) ?? undefined,
    listName: getSetting(db, CLICKUP_CONFIG_KEYS.listName) ?? undefined,
  }
}

export function saveClickUpApiKey(db: Database.Database, apiKey: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.apiKey, apiKey)
}

export function saveClickUpWorkspace(db: Database.Database, workspaceId: string, workspaceName: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.workspaceId, workspaceId)
  setSetting(db, CLICKUP_CONFIG_KEYS.workspaceName, workspaceName)
}

export function saveClickUpSpace(db: Database.Database, spaceId: string, spaceName: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.spaceId, spaceId)
  setSetting(db, CLICKUP_CONFIG_KEYS.spaceName, spaceName)
}

export function saveClickUpList(db: Database.Database, listId: string, listName: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.listId, listId)
  setSetting(db, CLICKUP_CONFIG_KEYS.listName, listName)
}

export function clearClickUpConfig(db: Database.Database): void {
  for (const key of Object.values(CLICKUP_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}

export function getClickUpApiKey(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'clickup') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_CLICKUP_API_KEY || process.env.CLICKUP_API_KEY
  if (envKey) return envKey

  // 3. Legacy: stored workspace setting
  return getSetting(db, CLICKUP_CONFIG_KEYS.apiKey)
}
