/**
 * Notion Configuration Storage
 *
 * Stores Notion credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'
import type { NotionConfig } from './types.js'

const NOTION_CONFIG_KEYS = {
  apiKey: 'notion.api_key',
  databaseId: 'notion.database_id',
  databaseName: 'notion.database_name',
} as const

/**
 * Check if Notion is configured.
 */
export function isNotionConfigured(db: Database.Database): boolean {
  const hasDbConfig = hasCredential(db, NOTION_CONFIG_KEYS.apiKey)
  if (hasDbConfig) return true

  return !!(process.env.PRLT_NOTION_API_KEY || process.env.NOTION_API_KEY)
}

/**
 * Load Notion configuration from the database + environment.
 */
export function loadNotionConfig(db: Database.Database): NotionConfig | null {
  const settings = new SettingsStore(db)
  const apiKey = getCredential(db, NOTION_CONFIG_KEYS.apiKey)
    || process.env.PRLT_NOTION_API_KEY
    || process.env.NOTION_API_KEY

  if (!apiKey) return null

  return {
    apiKey,
    databaseId: settings.get(NOTION_CONFIG_KEYS.databaseId)
      || process.env.PRLT_NOTION_DATABASE_ID
      || undefined,
    databaseName: settings.get(NOTION_CONFIG_KEYS.databaseName) || undefined,
  }
}

/**
 * Save Notion configuration to the database.
 */
export function saveNotionConfig(db: Database.Database, config: NotionConfig): void {
  const settings = new SettingsStore(db)
  setCredential(db, NOTION_CONFIG_KEYS.apiKey, config.apiKey)
  if (config.databaseId) {
    settings.set(NOTION_CONFIG_KEYS.databaseId, config.databaseId)
  }
  if (config.databaseName) {
    settings.set(NOTION_CONFIG_KEYS.databaseName, config.databaseName)
  }
}

export function saveNotionApiKey(db: Database.Database, apiKey: string): void {
  setCredential(db, NOTION_CONFIG_KEYS.apiKey, apiKey)
}

export function saveNotionDatabase(db: Database.Database, databaseId: string, databaseName: string): void {
  const settings = new SettingsStore(db)
  settings.set(NOTION_CONFIG_KEYS.databaseId, databaseId)
  settings.set(NOTION_CONFIG_KEYS.databaseName, databaseName)
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

/**
 * Get the Notion API key using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. If a Notion provider source is configured, resolve its apiKeyRef
 * 2. Legacy fallback: PRLT_NOTION_API_KEY or NOTION_API_KEY environment variables
 * 3. Legacy fallback: credential store key 'notion.api_key'
 */
export function getNotionApiKey(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'notion') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_NOTION_API_KEY || process.env.NOTION_API_KEY
  if (envKey) return envKey

  // 3. Legacy: stored credential
  return getCredential(db, NOTION_CONFIG_KEYS.apiKey)
}
