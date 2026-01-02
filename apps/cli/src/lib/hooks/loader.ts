/**
 * Hooks Loader
 *
 * Loads hook definitions from YAML files and database.
 * Supports loading from:
 * - .proletariat/hooks.yaml (workspace-level)
 * - Database workspace_settings table (for dynamic hooks)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'
import Database from 'better-sqlite3'
import {
  Hook,
  HooksYamlConfig,
  HookYamlDefinition,
  HookEventName,
  HookAction,
  HookCondition,
} from './types.js'
import { slugify } from '../pmo/utils.js'

// =============================================================================
// Constants
// =============================================================================

const HOOKS_YAML_FILENAME = 'hooks.yaml'
const HOOKS_DB_KEY_PREFIX = 'hooks.'

// =============================================================================
// YAML Loading
// =============================================================================

/**
 * Load hooks from YAML file
 */
export function loadHooksFromYaml(workspacePath: string): Hook[] {
  const hooksPath = path.join(workspacePath, '.proletariat', HOOKS_YAML_FILENAME)

  if (!fs.existsSync(hooksPath)) {
    return []
  }

  try {
    const content = fs.readFileSync(hooksPath, 'utf-8')
    const config = yaml.parse(content) as HooksYamlConfig

    if (!config || !config.hooks || !Array.isArray(config.hooks)) {
      return []
    }

    const defaults = config.defaults || {}

    return config.hooks.map((def, index) =>
      yamlDefinitionToHook(def, index, defaults)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load hooks from ${hooksPath}: ${message}`)
  }
}

/**
 * Convert a YAML hook definition to a Hook object
 */
function yamlDefinitionToHook(
  def: HookYamlDefinition,
  index: number,
  defaults: HooksYamlConfig['defaults']
): Hook {
  // Generate ID from name or use index-based ID
  const id = slugify(def.name) || `hook-${index}`

  // Apply defaults to spawn_agent actions
  const actions = def.actions.map(action => {
    if (action.type === 'spawn_agent' && defaults?.spawn_agent) {
      return {
        ...defaults.spawn_agent,
        ...action,
        type: 'spawn_agent' as const,
      }
    }
    return action
  })

  return {
    id,
    name: def.name,
    description: def.description,
    event: def.event,
    conditions: def.conditions || [],
    actions,
    enabled: def.enabled ?? defaults?.enabled ?? true,
    priority: def.priority,
    source: 'yaml',
    projectId: def.project,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// =============================================================================
// Database Loading
// =============================================================================

/**
 * Load hooks from database workspace_settings table
 */
export function loadHooksFromDatabase(db: Database.Database): Hook[] {
  const hooks: Hook[] = []

  // Get all hook settings from database
  const rows = db
    .prepare(`SELECT key, value FROM workspace_settings WHERE key LIKE ?`)
    .all(`${HOOKS_DB_KEY_PREFIX}%`) as Array<{ key: string; value: string }>

  for (const row of rows) {
    try {
      const hookData = JSON.parse(row.value) as Hook
      hooks.push({
        ...hookData,
        source: 'database',
      })
    } catch {
      // Skip invalid JSON entries
      continue
    }
  }

  return hooks
}

/**
 * Save a hook to the database
 */
export function saveHookToDatabase(db: Database.Database, hook: Hook): void {
  const key = `${HOOKS_DB_KEY_PREFIX}${hook.id}`
  const value = JSON.stringify({
    ...hook,
    updatedAt: new Date(),
  })

  db.prepare(`
    INSERT INTO workspace_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

/**
 * Delete a hook from the database
 */
export function deleteHookFromDatabase(db: Database.Database, hookId: string): boolean {
  const key = `${HOOKS_DB_KEY_PREFIX}${hookId}`
  const result = db
    .prepare(`DELETE FROM workspace_settings WHERE key = ?`)
    .run(key)
  return result.changes > 0
}

/**
 * Get a single hook from the database
 */
export function getHookFromDatabase(db: Database.Database, hookId: string): Hook | null {
  const key = `${HOOKS_DB_KEY_PREFIX}${hookId}`
  const row = db
    .prepare(`SELECT value FROM workspace_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined

  if (!row) {
    return null
  }

  try {
    return {
      ...JSON.parse(row.value),
      source: 'database',
    } as Hook
  } catch {
    return null
  }
}

// =============================================================================
// Combined Loading
// =============================================================================

/**
 * Load all hooks from both YAML and database
 * Database hooks take precedence over YAML hooks with the same ID
 */
export function loadAllHooks(workspacePath: string, db?: Database.Database): Hook[] {
  const hooks = new Map<string, Hook>()

  // Load YAML hooks first (lower precedence)
  const yamlHooks = loadHooksFromYaml(workspacePath)
  for (const hook of yamlHooks) {
    hooks.set(hook.id, hook)
  }

  // Load database hooks (higher precedence - can override YAML)
  if (db) {
    const dbHooks = loadHooksFromDatabase(db)
    for (const hook of dbHooks) {
      hooks.set(hook.id, hook)
    }
  }

  return Array.from(hooks.values())
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a hook definition
 */
export function validateHook(hook: Partial<Hook>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!hook.name || typeof hook.name !== 'string') {
    errors.push('Hook must have a name')
  }

  if (!hook.event || !isValidEventName(hook.event)) {
    errors.push(`Invalid event name: ${hook.event}`)
  }

  if (!hook.actions || !Array.isArray(hook.actions) || hook.actions.length === 0) {
    errors.push('Hook must have at least one action')
  } else {
    for (let i = 0; i < hook.actions.length; i++) {
      const actionErrors = validateAction(hook.actions[i])
      for (const error of actionErrors) {
        errors.push(`Action ${i + 1}: ${error}`)
      }
    }
  }

  if (hook.conditions) {
    for (let i = 0; i < hook.conditions.length; i++) {
      const conditionErrors = validateCondition(hook.conditions[i])
      for (const error of conditionErrors) {
        errors.push(`Condition ${i + 1}: ${error}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Check if an event name is valid
 */
function isValidEventName(event: string): event is HookEventName {
  const validEvents: HookEventName[] = [
    'ticket.created',
    'ticket.moved',
    'ticket.updated',
    'ticket.status_changed',
    'ticket.deleted',
    'ticket.completed',
    'epic.created',
    'epic.updated',
    'epic.status_changed',
    'epic.deleted',
    'work.started',
    'work.completed',
  ]
  return validEvents.includes(event as HookEventName)
}

/**
 * Validate an action
 */
function validateAction(action: HookAction): string[] {
  const errors: string[] = []

  if (!action.type) {
    errors.push('Action must have a type')
    return errors
  }

  switch (action.type) {
    case 'spawn_agent':
      // spawn_agent doesn't require additional fields
      break

    case 'shell':
      if (!action.command) {
        errors.push('Shell action must have a command')
      }
      break

    case 'log':
      if (!action.message) {
        errors.push('Log action must have a message')
      }
      break

    case 'notify':
      if (!action.channel) {
        errors.push('Notify action must have a channel')
      }
      if (!action.message) {
        errors.push('Notify action must have a message')
      }
      break

    case 'webhook':
      if (!action.url) {
        errors.push('Webhook action must have a URL')
      }
      break

    default:
      errors.push(`Unknown action type: ${(action as HookAction).type}`)
  }

  return errors
}

/**
 * Validate a condition
 */
function validateCondition(condition: HookCondition): string[] {
  const errors: string[] = []

  if (!condition.field) {
    errors.push('Condition must have a field')
  }

  if (!condition.operator) {
    errors.push('Condition must have an operator')
  } else {
    const validOperators = [
      'equals', 'not_equals', 'contains', 'not_contains',
      'starts_with', 'ends_with', 'matches', 'in', 'not_in'
    ]
    if (!validOperators.includes(condition.operator)) {
      errors.push(`Invalid operator: ${condition.operator}`)
    }
  }

  if (condition.value === undefined) {
    errors.push('Condition must have a value')
  }

  return errors
}

// =============================================================================
// Template Generation
// =============================================================================

/**
 * Generate a template hooks.yaml file
 */
export function generateHooksTemplate(): string {
  const template: HooksYamlConfig = {
    version: 1,
    defaults: {
      enabled: true,
      spawn_agent: {
        strategy: 'round-robin',
        environment: 'devcontainer',
        displayMode: 'terminal',
      },
    },
    hooks: [
      {
        name: 'auto_spawn_ready',
        description: 'Auto-spawn agent when ticket moves to Ready column',
        event: 'ticket.moved',
        conditions: [
          {
            field: 'toColumn',
            operator: 'equals',
            value: 'Ready',
          },
        ],
        actions: [
          {
            type: 'spawn_agent',
            strategy: 'round-robin',
            limit: 1,
          },
        ],
        enabled: true,
        priority: 10,
      },
      {
        name: 'log_ticket_created',
        description: 'Log when a new ticket is created',
        event: 'ticket.created',
        actions: [
          {
            type: 'log',
            message: 'New ticket created: {{ticket.id}} - {{ticket.title}}',
            level: 'info',
          },
        ],
        enabled: true,
      },
    ],
  }

  return yaml.stringify(template, {
    indent: 2,
    lineWidth: 100,
  })
}

/**
 * Create a hooks.yaml file if it doesn't exist
 */
export function ensureHooksYamlExists(workspacePath: string): boolean {
  const hooksDir = path.join(workspacePath, '.proletariat')
  const hooksPath = path.join(hooksDir, HOOKS_YAML_FILENAME)

  if (fs.existsSync(hooksPath)) {
    return false
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true })
  }

  fs.writeFileSync(hooksPath, generateHooksTemplate())
  return true
}
