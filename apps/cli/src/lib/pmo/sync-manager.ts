/**
 * PMO Sync Manager
 *
 * Handles automatic bi-directional sync between SQLite database and board.md:
 * - Auto-sync from board.md before read operations (if file is newer)
 * - Auto-export to board.md after write operations
 *
 * Uses hybrid mtime + content-based sync detection:
 * 1. Check mtime first (fast) - if unchanged, skip
 * 2. If mtime changed, compare content - if same, just update stored mtime
 * 3. If content differs, perform full sync
 *
 * Multi-project support:
 * - Default project: pmo/board.md
 * - Other projects: pmo/board-{projectId}.md
 *
 * Clock source: Uses filesystem mtime which comes from the OS system clock
 * (computer/VM clock depending on where the filesystem resides)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SQLiteStorage } from './storage-sqlite.js';
import { initWorkLifecycleAdapter } from '../work-lifecycle/adapter.js';
import { initOutboundSync } from '../external-issues/outbound-sync.js';
import { initHookManager } from '../work-lifecycle/hooks/index.js';
import { initWorkflowRuleEvaluator } from '../work-lifecycle/rule-evaluator.js';
import { initActionChaining } from '../work-lifecycle/action-chaining.js';
import { initContainerCleanupHook } from '../work-lifecycle/container-cleanup-hook.js';
import { initTriggerHandler } from '../providers/trigger-config.js';
import { resolveTicketProvider } from '../providers/resolver.js';

/**
 * Get the board path for a project
 * Standard: pmo/projects/{projectId}/kanban.md
 * Falls back to legacy paths for backwards compatibility
 */
export function getBoardPath(pmoPath: string, projectId: string): string {
  const kanbanPath = path.join(pmoPath, 'projects', projectId, 'kanban.md');
  const legacyBoardPath = path.join(pmoPath, 'projects', projectId, 'board.md');
  const legacyProjectKanbanPath = path.join(pmoPath, 'projects', projectId, `${projectId}-kanban.md`);
  const legacyProjectPath = path.join(pmoPath, 'projects', projectId, `${projectId}.md`);

  // Check paths in order of preference
  if (fs.existsSync(kanbanPath)) {
    return kanbanPath;
  }
  if (fs.existsSync(legacyBoardPath)) {
    return legacyBoardPath;
  }
  if (fs.existsSync(legacyProjectKanbanPath)) {
    return legacyProjectKanbanPath;
  }
  if (fs.existsSync(legacyProjectPath)) {
    return legacyProjectPath;
  }
  // Default to standard kanban.md for new projects
  return kanbanPath;
}

export interface PMOContext {
  pmoPath: string;
  storage: SQLiteStorage;
  storageType: 'sqlite' | 'git';
}

/**
 * Auto-sync from board.md — DISABLED.
 * The local ticket store has been removed (PRLT-1299). The provider
 * (Linear, Jira, etc.) is now the source of truth. Board sync is a no-op.
 */
export function autoSyncFromBoard(
  _pmoPath: string,
  _storage: SQLiteStorage,
  _logger?: (msg: string) => void,
  _projectId?: string
): boolean {
  return false;
}

/**
 * Auto-export database to board.md after write operations
 *
 * DISABLED: Markdown sync is disabled. DB is the sole source of truth.
 * To re-enable, uncomment the function body below.
 */
export async function autoExportToBoard(
  _pmoPath: string,
  _storage: SQLiteStorage,
  _logger?: (msg: string) => void,
  _projectId?: string
): Promise<void> {
  // DISABLED: Markdown export disabled - DB is source of truth
  // Uncomment below to re-enable:
  /*
  const pid = _projectId ?? _storage.getCurrentProjectId();
  const boardPath = getBoardPath(_pmoPath, pid);

  // Generate markdown from current database state
  const markdown = await _storage.getBoardMarkdown();

  // Write to board.md
  fs.writeFileSync(boardPath, markdown);

  // Update sync metadata with new mtime and content hash
  const stats = fs.statSync(boardPath);
  const contentHash = computeHash(markdown);
  updateSyncMetadata(_storage, stats.mtimeMs, contentHash);

  if (_logger) {
    _logger(`📤 Auto-exported to ${path.basename(boardPath)}`);
  }
  */
}

/**
 * Get the workspace.db path from a PMO path
 * PMO can be at <workspace>/pmo or <workspace>/repos/<repo>/pmo
 * workspace.db is always at <workspace>/.proletariat/workspace.db
 */
export function getWorkspaceDbPath(pmoPath: string): string {
  // Search upward from PMO path to find .proletariat/workspace.db
  let currentDir = path.dirname(pmoPath); // Start from parent of pmo/

  while (currentDir !== '/') {
    const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback to old behavior if not found
  const workspacePath = path.dirname(pmoPath);
  return path.join(workspacePath, '.proletariat', 'workspace.db');
}

/**
 * Get storage with auto-sync from board.md (for read operations)
 * Use this when you need to READ from the database
 *
 * Note: storageType parameter controls sync strategy, not storage engine.
 * - All modes use SQLite (workspace.db) for storage
 * - 'git' mode enables multi-machine sync via git push/pull
 * - 'sqlite' mode is local-only (no multi-machine sync)
 */
export function getStorageWithAutoSync(
  pmoPath: string,
  _storageType: 'sqlite' | 'git',
  _logger?: (msg: string) => void
): SQLiteStorage {
  // Storage is always workspace.db (unified PMO tables with foreign keys to agents)
  const dbPath = getWorkspaceDbPath(pmoPath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run 'prlt new' first.`);
  }

  // Note: Storage no longer holds project context - projectId is passed explicitly to operations
  const storage = new SQLiteStorage(dbPath);

  // Initialize work-lifecycle adapter (event hub for all providers)
  // In the new architecture, EventEmittingProvider emits both ticket:* and
  // work:* events. The adapter coordinates cross-cutting concerns.
  initWorkLifecycleAdapter();

  // Initialize outbound sync hooks (subscribes to work:* events)
  initOutboundSync(storage.getDatabase());

  // Initialize work-lifecycle hooks (user-configured event-driven actions)
  initHookManager(storage.getDatabase());

  // Initialize workflow rule evaluator (evaluates rules when tickets change state)
  initWorkflowRuleEvaluator(storage.getDatabase());

  // Initialize action chaining (auto-spawns next action on workflow rule matches)
  initActionChaining(storage.getDatabase(), storage, pmoPath);

  // Initialize container cleanup hook (auto-removes Docker containers when agents stop)
  initContainerCleanupHook();

  // Initialize configurable trigger handler (agent_started, pr_created, etc. → target column)
  // Since PRLT-1299, local ticket store is gone — moves go directly to the provider.
  initTriggerHandler(storage.getDatabase(), async (ticketId, projectId, targetStatus) => {
    try {
      // Build synthetic metadata for provider resolution
      const metadata = /^[A-Z]+-\d+$/i.test(ticketId)
        ? { external_source: 'linear', external_key: ticketId }
        : null;
      const provider = resolveTicketProvider(ticketId, projectId, storage.getDatabase(), storage as never, metadata);
      if (provider.name !== 'pmo') {
        await provider.moveTicket(ticketId, targetStatus);
      }
    } catch {
      // Non-fatal — don't block triggers for provider sync failures
    }
  });

  return storage;
}

/**
 * Wrapper for write operations that auto-exports to board.md after
 */
export async function withAutoExport<T>(
  pmoPath: string,
  storage: SQLiteStorage,
  operation: () => Promise<T>,
  logger?: (msg: string) => void
): Promise<T> {
  // Run the operation
  const result = await operation();

  // Auto-export to board.md
  await autoExportToBoard(pmoPath, storage, logger);

  return result;
}
