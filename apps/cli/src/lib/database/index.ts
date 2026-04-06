/**
 * Database Module - Re-export Facade
 *
 * This module re-exports all database operations from domain-specific modules.
 * Consumers should import from this index for backward compatibility.
 *
 * Domain modules:
 * - workspace.ts  - Database lifecycle (open, create, config)
 * - agents.ts     - Agent CRUD operations
 * - repositories.ts - Repository operations
 * - themes.ts     - Agent naming theme operations
 * - worktrees.ts  - Agent worktree queries
 * - media.ts      - Media item operations
 * - pmo-bootstrap.ts - PMO initialization/teardown
 * - driver.ts     - DatabaseDriver abstraction layer
 * - settings-store.ts - Workspace settings key-value store
 */

// Re-export CREATE_TABLES_SQL from its canonical location
export { CREATE_TABLES_SQL } from './workspace-schema.js'

// Workspace lifecycle
export {
  type WorkspaceConfig,
  withDrizzle,
  getDatabasePath,
  getConfigPath,
  openWorkspaceDatabase,
  openWorkspaceDriver,
  createWorkspaceDatabase,
  getWorkspaceConfig,
} from './workspace.js'

// Agent operations
export {
  type AgentType,
  type AgentStatus,
  type MountMode,
  type Agent,
  type DiscoverResult,
  type PruneOptions,
  type PruneResult,
  RECYCLABLE_STATUSES,
  ACTIVE_STATUSES,
  addAgentsToDatabase,
  addEphemeralAgentToDatabase,
  tryAddEphemeralAgentToDatabase,
  getEphemeralAgentNames,
  removeEphemeralAgent,
  getWorkspaceAgents,
  getAgentByPath,
  getAgent,
  markAgentCleaned,
  markAgentRunning,
  markAgentCompleted,
  markAgentDead,
  reactivateAgent,
  pruneAgentRecords,
  syncAgentsWithDisk,
  discoverAgentsOnDisk,
  removeAgentsFromDatabase,
} from './agents.js'

// Repository operations
export {
  type Repository,
  addRepositoriesToDatabase,
  getWorkspaceRepositories,
} from './repositories.js'

// Theme operations
export {
  type AgentTheme,
  type AgentThemeName,
  getActiveTheme,
  setActiveTheme,
  getThemes,
  getTheme,
  createTheme,
  deleteTheme,
  getThemeNames,
  getAvailableThemeNames,
  addThemeNames,
} from './themes.js'

// Worktree operations
export {
  type AgentWorktree,
  getAgentWorktrees,
  findWorktreesByBranch,
  getWorktreesForRepo,
} from './worktrees.js'

// Media item operations
export {
  type MediaItem,
  addMediaItemToDatabase,
  updateMediaItemStatus,
  getWorkspaceMediaItems,
  getMediaItem,
  removeMediaItemFromDatabase,
} from './media.js'

// PMO bootstrap operations
export {
  checkPMOExists,
  getPMOSetting,
  dropPMOTables,
  upsertWorkspaceSetting,
} from './pmo-bootstrap.js'

// Database driver abstraction
export {
  type DatabaseDriver,
  type PreparedStatement,
  type RunResult,
  BetterSqlite3Driver,
  wrapDatabase,
  openDriver,
  getRawDatabase,
} from './driver.js'

// Settings store
export {
  SettingsStore,
  createSettingsStore,
} from './settings-store.js'

// Credential store (PRLT-1114: agent secret isolation)
export {
  isCredentialKey,
  getCredentialDatabasePath,
  getCredential,
  setCredential,
  deleteCredential,
  hasCredential,
  closeAllCredentialStores,
  migrateCredentials,
} from './credential-store.js'

// Database safety (WAL, backup, integrity, repair)
export {
  enableWALMode,
  configureConnection,
  type ConfigureConnectionOptions,
  createRotatingBackup,
  createManualBackup,
  checkIntegrity,
  quickCheckIntegrity,
  checkSchemaCompleteness,
  repairDatabase,
  getBackupPath,
  getBackupsDir,
  listBackups,
  migrateExistingBackups,
  type IntegrityCheckResult,
  type SchemaCheckResult,
  type RepairResult,
} from './db-safety.js'
