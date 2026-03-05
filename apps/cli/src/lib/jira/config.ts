/**
 * Jira Configuration Storage
 *
 * Stores Jira credentials and preferences in the workspace_settings table.
 * Mirrors the Linear config module pattern.
 */

import Database from 'better-sqlite3'

const SETTINGS_TABLE = 'workspace_settings'

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
 * Check if Jira is configured.
 * Returns true if either:
 * - Database has jira.base_url AND jira.api_token stored, OR
 * - Environment variables PRLT_JIRA_BASE_URL/JIRA_BASE_URL and PRLT_JIRA_API_TOKEN/JIRA_API_TOKEN are set
 */
export function isJiraConfigured(db: Database.Database): boolean {
  const hasDbConfig = getSetting(db, JIRA_CONFIG_KEYS.baseUrl) !== null
    && getSetting(db, JIRA_CONFIG_KEYS.apiToken) !== null

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
 * Returns null if not configured.
 */
export function loadJiraConfig(db: Database.Database): JiraConfig | null {
  const baseUrl = getSetting(db, JIRA_CONFIG_KEYS.baseUrl)
    || process.env.PRLT_JIRA_BASE_URL
    || process.env.JIRA_BASE_URL
    || process.env.PRLT_JIRA_HOST
    || process.env.JIRA_HOST

  const apiToken = getSetting(db, JIRA_CONFIG_KEYS.apiToken)
    || process.env.PRLT_JIRA_API_TOKEN
    || process.env.JIRA_API_TOKEN

  if (!baseUrl || !apiToken) return null

  return {
    baseUrl,
    email: getSetting(db, JIRA_CONFIG_KEYS.email)
      || process.env.PRLT_JIRA_EMAIL
      || process.env.JIRA_EMAIL
      || undefined,
    apiToken,
    projectKey: getSetting(db, JIRA_CONFIG_KEYS.projectKey)
      || process.env.PRLT_JIRA_PROJECT
      || process.env.JIRA_PROJECT_KEY
      || undefined,
  }
}

/**
 * Save Jira configuration to the database.
 */
export function saveJiraConfig(db: Database.Database, config: JiraConfig): void {
  setSetting(db, JIRA_CONFIG_KEYS.baseUrl, config.baseUrl)
  setSetting(db, JIRA_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.email) {
    setSetting(db, JIRA_CONFIG_KEYS.email, config.email)
  }
  if (config.projectKey) {
    setSetting(db, JIRA_CONFIG_KEYS.projectKey, config.projectKey)
  }
}

/**
 * Clear all Jira configuration from the database.
 */
export function clearJiraConfig(db: Database.Database): void {
  for (const key of Object.values(JIRA_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}
