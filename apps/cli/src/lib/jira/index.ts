/**
 * Jira Integration Module
 *
 * Provides Jira configuration loading and validation.
 */

export {
  isJiraConfigured,
  loadJiraConfig,
  saveJiraConfig,
  clearJiraConfig,
} from './config.js'
export type { JiraConfig } from './config.js'
