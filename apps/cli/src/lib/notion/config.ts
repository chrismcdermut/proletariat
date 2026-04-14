import type Database from 'better-sqlite3'
import type { NotionConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const NOTION_CONFIG_KEYS = {
  apiKey: 'notion.api_key',
  defaultDatabaseId: 'notion.default_database_id',
  defaultDatabaseName: 'notion.default_database_name',
  statusPropertyName: 'notion.status_property_name',
  titlePropertyName: 'notion.title_property_name',
} as const

export function isNotionConfigured(db: Database.Database): boolean {
  if (hasCredential(db, NOTION_CONFIG_KEYS.apiKey)) return true
  return !!(process.env.PRLT_NOTION_API_KEY || process.env.NOTION_API_KEY)
}

export function loadNotionConfig(db: Database.Database): NotionConfig | null {
  const apiKey = getCredential(db, NOTION_CONFIG_KEYS.apiKey)
  if (!apiKey) return null
  const settings = new SettingsStore(db)
  return {
    apiKey,
    defaultDatabaseId: settings.get(NOTION_CONFIG_KEYS.defaultDatabaseId) ?? undefined,
    defaultDatabaseName: settings.get(NOTION_CONFIG_KEYS.defaultDatabaseName) ?? undefined,
    statusPropertyName: settings.get(NOTION_CONFIG_KEYS.statusPropertyName) ?? undefined,
    titlePropertyName: settings.get(NOTION_CONFIG_KEYS.titlePropertyName) ?? undefined,
  }
}

export function saveNotionApiKey(db: Database.Database, apiKey: string): void {
  setCredential(db, NOTION_CONFIG_KEYS.apiKey, apiKey)
}

export function saveNotionDefaultDatabase(db: Database.Database, databaseId: string, databaseName: string): void {
  const settings = new SettingsStore(db)
  settings.set(NOTION_CONFIG_KEYS.defaultDatabaseId, databaseId)
  settings.set(NOTION_CONFIG_KEYS.defaultDatabaseName, databaseName)
}

export function clearNotionConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(NOTION_CONFIG_KEYS)) {
    if (key === NOTION_CONFIG_KEYS.apiKey) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}

export function getNotionApiKey(db: Database.Database): string | null {
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'notion') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch { /* Provider sources table may not exist */ }

  const envKey = process.env.PRLT_NOTION_API_KEY || process.env.NOTION_API_KEY
  if (envKey) return envKey

  return getCredential(db, NOTION_CONFIG_KEYS.apiKey)
}
