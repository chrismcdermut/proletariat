import Database from 'better-sqlite3'
import { loadAsanaConfig } from '../asana/config.js'
import { loadLinearConfig } from '../linear/config.js'
import { loadJiraConfig } from '../jira/config.js'
import { loadShortcutConfig } from '../shortcut/config.js'
import { loadTrelloConfig } from '../trello/config.js'
import { loadMondayConfig } from '../monday/config.js'
import { loadProviderSources } from './provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'
const DEFAULT_SOURCE_KEY = 'work.default_source'
/** @deprecated Old key kept for migration — use DEFAULT_SOURCE_KEY */
const LEGACY_ACTIVE_SOURCE_KEY = 'work.active_source'

export const WORK_SOURCE_PROVIDERS = ['pmo', 'linear', 'jira', 'shortcut', 'asana', 'trello', 'monday'] as const
export type WorkSourceProvider = typeof WORK_SOURCE_PROVIDERS[number]

export interface WorkSourceRef {
  provider: WorkSourceProvider
  context?: string
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

export function isWorkSourceProvider(value: string): value is WorkSourceProvider {
  return (WORK_SOURCE_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Check if a ticket identifier looks like a local PMO ticket ID (e.g. TKT-123).
 * Local IDs always start with the TKT- prefix.
 */
export function isLocalTicketId(ticketId: string): boolean {
  return /^TKT-\d+$/i.test(ticketId)
}

export function parseWorkSourceRef(input: string): WorkSourceRef {
  const raw = input.trim()
  if (!raw) {
    throw new Error('Work source cannot be empty.')
  }

  const separatorIndex = raw.indexOf(':')
  const providerText = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex)
  const provider = providerText.toLowerCase()

  if (!isWorkSourceProvider(provider)) {
    throw new Error(`Unsupported work source provider "${providerText}". Allowed: ${WORK_SOURCE_PROVIDERS.join(', ')}`)
  }

  const rawContext = separatorIndex === -1 ? '' : raw.slice(separatorIndex + 1).trim()
  const context = rawContext.length > 0 ? rawContext : undefined

  return { provider, context }
}

export function formatWorkSourceRef(source: WorkSourceRef): string {
  return source.context ? `${source.provider}:${source.context}` : source.provider
}

export function saveDefaultWorkSource(db: Database.Database, source: WorkSourceRef): void {
  setSetting(db, DEFAULT_SOURCE_KEY, formatWorkSourceRef(source))
  // Clean up legacy key if it exists
  deleteSetting(db, LEGACY_ACTIVE_SOURCE_KEY)
}

export function clearDefaultWorkSource(db: Database.Database): void {
  deleteSetting(db, DEFAULT_SOURCE_KEY)
  deleteSetting(db, LEGACY_ACTIVE_SOURCE_KEY)
}

export function loadDefaultWorkSource(db: Database.Database): WorkSourceRef | null {
  // Check new key first
  let raw = getSetting(db, DEFAULT_SOURCE_KEY)

  // Fall back to legacy key and migrate
  if (!raw) {
    raw = getSetting(db, LEGACY_ACTIVE_SOURCE_KEY)
    if (raw) {
      // Migrate to new key
      setSetting(db, DEFAULT_SOURCE_KEY, raw)
      deleteSetting(db, LEGACY_ACTIVE_SOURCE_KEY)
    }
  }

  if (!raw) return null

  try {
    return parseWorkSourceRef(raw)
  } catch {
    return null
  }
}

/** @deprecated Use saveDefaultWorkSource instead */
export const saveActiveWorkSource = saveDefaultWorkSource
/** @deprecated Use clearDefaultWorkSource instead */
export const clearActiveWorkSource = clearDefaultWorkSource
/** @deprecated Use loadDefaultWorkSource instead */
export const loadActiveWorkSource = loadDefaultWorkSource

export function getRegisteredWorkSources(db: Database.Database): WorkSourceRef[] {
  const providers = new Map<WorkSourceProvider, WorkSourceRef>()
  providers.set('pmo', { provider: 'pmo' })

  const linearConfig = loadLinearConfig(db)
  if (linearConfig) {
    providers.set('linear', {
      provider: 'linear',
      context: linearConfig.defaultTeamKey ?? undefined,
    })
  }

  const jiraConfig = loadJiraConfig(db)
  if (jiraConfig) {
    providers.set('jira', {
      provider: 'jira',
      context: jiraConfig.projectKey ?? undefined,
    })
  }

  const asanaConfig = loadAsanaConfig(db)
  if (asanaConfig) {
    providers.set('asana', {
      provider: 'asana',
      context: asanaConfig.projectName ?? asanaConfig.projectGid ?? undefined,
    })
  }

  const shortcutConfig = loadShortcutConfig(db)
  if (shortcutConfig) {
    providers.set('shortcut', {
      provider: 'shortcut',
      context: shortcutConfig.workspaceSlug ?? undefined,
    })
  }

  const trelloConfig = loadTrelloConfig(db)
  if (trelloConfig) {
    providers.set('trello', {
      provider: 'trello',
      context: trelloConfig.boardName ?? trelloConfig.boardId ?? undefined,
    })
  }

  // Append multi-source provider entries. These use a composite key
  // (provider + ':' + prefix) so they don't overwrite single-provider
  // entries already in the map.
  const multiSources = loadProviderSources(db)
  for (const source of multiSources) {
    const key = `${source.provider}:${source.prefix}` as WorkSourceProvider
    providers.set(key, {
      provider: source.provider,
      context: source.teamProjectId,
    })
  }

  return Array.from(providers.values())
}

/**
 * Get a list of connected integration provider names (excluding 'pmo').
 * Used to dynamically inject integration commands into agent prompts.
 */
export function getConnectedIntegrations(db: Database.Database): string[] {
  const integrations: string[] = []

  if (loadAsanaConfig(db)) integrations.push('asana')
  if (loadLinearConfig(db)) integrations.push('linear')
  if (loadJiraConfig(db)) integrations.push('jira')
  if (loadShortcutConfig(db)) integrations.push('shortcut')
  if (loadTrelloConfig(db)) integrations.push('trello')
  if (loadMondayConfig(db)) integrations.push('monday')

  return integrations
}
