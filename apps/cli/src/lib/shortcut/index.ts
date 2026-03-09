/**
 * Shortcut Integration Module
 *
 * Provides Shortcut configuration, API client, mapper, and sync.
 */

export {
  isShortcutConfigured,
  loadShortcutConfig,
  saveShortcutConfig,
  saveShortcutApiToken,
  saveShortcutWorkspaceSlug,
  clearShortcutConfig,
  getShortcutApiToken,
} from './config.js'
export type { ShortcutConfig } from './config.js'

export { ShortcutClient, ShortcutNotFoundError } from './client.js'
export type { ShortcutStory, ShortcutWorkflowState, ShortcutStoryUpdateInput } from './client.js'

export { ShortcutMapper } from './mapper.js'
export type { ShortcutStoryMap } from './mapper.js'

export { ShortcutSync } from './sync.js'
