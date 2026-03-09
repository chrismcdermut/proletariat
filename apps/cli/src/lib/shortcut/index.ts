/**
 * Shortcut Integration Module
 *
 * Provides Shortcut configuration loading and validation.
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
