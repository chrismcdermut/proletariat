/**
 * Shortcut Integration Module
 *
 * Provides Shortcut configuration loading and validation.
 */

export {
  SHORTCUT_API_TOKEN_ENV_VAR,
  isShortcutConfigured,
  loadShortcutConfig,
  saveShortcutConfig,
  saveShortcutApiToken,
  saveShortcutWorkspaceSlug,
  clearShortcutConfig,
  getShortcutApiToken,
} from './config.js'
export type { ShortcutConfig } from './config.js'
