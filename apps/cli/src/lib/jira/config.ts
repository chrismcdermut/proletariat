/**
 * Jira Configuration Storage
 *
 * Stores Jira credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const JIRA_CONFIG_KEYS = {
  baseUrl: 'jira.base_url',
  email: 'jira.email',
  apiToken: 'jira.api_token',
  projectKey: 'jira.project_key',
} as const

export interface JiraConfig {
  baseUrl: string
  email?: string
  apiToken: string
  projectKey?: string
}

/**
 * Check if Jira is configured.
 */
export function isJiraConfigured(db: Database.Database): boolean {
  // Check provider sources first
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'jira') {
        const key = resolveApiKey(db, source)
        if (key) return true
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  const settings = new SettingsStore(db)
  const hasDbConfig = settings.has(JIRA_CONFIG_KEYS.baseUrl)
    && hasCredential(db, JIRA_CONFIG_KEYS.apiToken)

  if (hasDbConfig) return true

  const hasEnvUrl = !!(
    process.env.PRLT_JIRA_BASE_URL
    || process.env.JIRA_BASE_URL
    || process.env.PRLT_JIRA_HOST
    || process.env.JIRA_HOST
  )
  const hasEnvToken = !!(process.env.PRLT_JIRA_API_TOKEN || process.env.JIRA_API_TOKEN)

  return hasEnvUrl && hasEnvToken
}

/**
 * Load Jira configuration from the database + environment.
 */
export function loadJiraConfig(db: Database.Database): JiraConfig | null {
  const settings = new SettingsStore(db)
  const baseUrl = settings.get(JIRA_CONFIG_KEYS.baseUrl)
    || process.env.PRLT_JIRA_BASE_URL
    || process.env.JIRA_BASE_URL
    || process.env.PRLT_JIRA_HOST
    || process.env.JIRA_HOST

  const apiToken = getCredential(db, JIRA_CONFIG_KEYS.apiToken)
    || process.env.PRLT_JIRA_API_TOKEN
    || process.env.JIRA_API_TOKEN

  if (!baseUrl || !apiToken) return null

  return {
    baseUrl,
    email: settings.get(JIRA_CONFIG_KEYS.email)
      || process.env.PRLT_JIRA_EMAIL
      || process.env.JIRA_EMAIL
      || undefined,
    apiToken,
    projectKey: settings.get(JIRA_CONFIG_KEYS.projectKey)
      || process.env.PRLT_JIRA_PROJECT
      || process.env.JIRA_PROJECT_KEY
      || undefined,
  }
}

/**
 * Save Jira configuration to the database.
 */
export function saveJiraConfig(db: Database.Database, config: JiraConfig): void {
  const settings = new SettingsStore(db)
  settings.set(JIRA_CONFIG_KEYS.baseUrl, config.baseUrl)
  setCredential(db, JIRA_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.email) {
    settings.set(JIRA_CONFIG_KEYS.email, config.email)
  }
  if (config.projectKey) {
    settings.set(JIRA_CONFIG_KEYS.projectKey, config.projectKey)
  }
}

/**
 * Get the Jira API token using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. If a Jira provider source is configured, resolve its apiKeyRef
 * 2. Legacy fallback: PRLT_JIRA_API_TOKEN or JIRA_API_TOKEN environment variables
 * 3. Legacy fallback: credential store key 'jira.api_token'
 */
export function getJiraApiToken(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'jira') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envToken = process.env.PRLT_JIRA_API_TOKEN || process.env.JIRA_API_TOKEN
  if (envToken) return envToken

  // 3. Legacy: stored credential
  return getCredential(db, JIRA_CONFIG_KEYS.apiToken)
}

/**
 * Clear all Jira configuration from the database.
 */
export function clearJiraConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(JIRA_CONFIG_KEYS)) {
    if (key === JIRA_CONFIG_KEYS.apiToken) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}
