/**
 * Event-Based Hooks System
 *
 * Main entry point for the hooks system.
 * Re-exports all types and provides initialization functions.
 */

import Database from 'better-sqlite3'
import {
  HooksManager,
  getHooksManager,
  resetHooksManager,
  isHooksManagerInitialized,
} from './manager.js'
import { loadAllHooks, ensureHooksYamlExists, generateHooksTemplate } from './loader.js'

// Re-export types
export * from './types.js'

// Re-export manager
export {
  HooksManager,
  getHooksManager,
  resetHooksManager,
  isHooksManagerInitialized,
} from './manager.js'

// Re-export loader functions
export {
  loadHooksFromYaml,
  loadHooksFromDatabase,
  loadAllHooks,
  saveHookToDatabase,
  deleteHookFromDatabase,
  getHookFromDatabase,
  validateHook,
  generateHooksTemplate,
  ensureHooksYamlExists,
} from './loader.js'

// Re-export actions
export { executeAction } from './actions/index.js'

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the hooks system for a workspace.
 * Loads hooks from YAML and database, and registers them with the manager.
 */
export function initializeHooks(options: {
  workspacePath: string
  pmoPath: string
  db?: Database.Database
  log?: (message: string) => void
}): HooksManager {
  const { workspacePath, pmoPath, db, log = () => {} } = options

  // Create or get the hooks manager
  const manager = new HooksManager({
    workspacePath,
    pmoPath,
    log,
  })

  // Load hooks from all sources
  const hooks = loadAllHooks(workspacePath, db)

  // Register hooks with manager
  manager.registerHooks(hooks)

  log(`Loaded ${hooks.length} hooks`)

  return manager
}

/**
 * Initialize hooks if not already initialized, or return existing manager.
 * Safe to call multiple times.
 */
export function ensureHooksInitialized(options: {
  workspacePath: string
  pmoPath: string
  db?: Database.Database
  log?: (message: string) => void
}): HooksManager {
  if (isHooksManagerInitialized()) {
    return getHooksManager()
  }
  return initializeHooks(options)
}
