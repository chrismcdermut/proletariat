/**
 * PMO Board Watcher
 *
 * Watches board.md for changes and automatically syncs to SQLite database.
 * Uses chokidar for efficient cross-platform file watching.
 *
 * Features:
 * - Debounced sync (waits for file to stabilize before syncing)
 * - Hybrid mtime + content detection (avoids unnecessary syncs)
 * - Graceful shutdown handling
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { watch, FSWatcher } from 'chokidar';
import { onShutdown } from '../signal-handler.js';

export interface WatcherOptions {
  /** Debounce delay in milliseconds (default: 500) */
  debounceMs?: number;
  /** Logger function for status messages */
  logger?: (msg: string) => void;
  /** Callback when sync occurs */
  onSync?: (stats: SyncStats) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface SyncStats {
  syncedAt: Date;
  ticketCount: number;
  durationMs: number;
}

export interface WatcherInstance {
  /** Stop watching */
  stop: () => Promise<void>;
  /** Force a sync now */
  syncNow: () => Promise<SyncStats>;
  /** Check if watcher is running */
  isRunning: () => boolean;
}

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get the workspace.db path from a PMO path
 */
function getWorkspaceDbPath(pmoPath: string): string {
  const workspacePath = path.dirname(pmoPath);
  return path.join(workspacePath, '.proletariat', 'workspace.db');
}

/**
 * Start watching kanban.md for changes
 */
export function startWatcher(
  pmoPath: string,
  storageType: 'sqlite' | 'git',
  options: WatcherOptions = {},
  projectId?: string
): WatcherInstance {
  const {
    debounceMs = 500,
    logger = () => {},
    onSync,
    onError,
  } = options;

  // Get board path - either from projectId or find first project
  let boardPath: string;
  if (projectId) {
    boardPath = path.join(pmoPath, 'projects', projectId, 'kanban.md');
    // Fall back to legacy board.md
    if (!fs.existsSync(boardPath)) {
      boardPath = path.join(pmoPath, 'projects', projectId, 'board.md');
    }
  } else {
    // Legacy: look for board.md in pmo root
    boardPath = path.join(pmoPath, 'board.md');
    if (!fs.existsSync(boardPath)) {
      // Try to find first project
      const projectsDir = path.join(pmoPath, 'projects');
      if (fs.existsSync(projectsDir)) {
        const projects = fs.readdirSync(projectsDir).filter(f =>
          fs.statSync(path.join(projectsDir, f)).isDirectory()
        );
        if (projects.length > 0) {
          const firstProject = projects[0];
          boardPath = path.join(projectsDir, firstProject, 'kanban.md');
          if (!fs.existsSync(boardPath)) {
            boardPath = path.join(projectsDir, firstProject, 'board.md');
          }
        }
      }
    }
  }

  // All storage types now use unified workspace.db
  const dbPath = getWorkspaceDbPath(pmoPath);

  // Validate paths exist
  if (!fs.existsSync(boardPath)) {
    throw new Error(`kanban.md not found at ${boardPath}`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run 'prlt new' first.`);
  }

  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let lastHash: string | null = null;
  let isRunning = true;

  // Initialize last hash from current file
  try {
    const content = fs.readFileSync(boardPath, 'utf-8');
    lastHash = computeHash(content);
  } catch {
    // Ignore - will sync on first change
  }

  /**
   * Perform sync from board.md to SQLite.
   * DISABLED: The local ticket store has been removed (PRLT-1299). The
   * provider is now the source of truth. This is a no-op stub that
   * preserves the watcher API contract.
   */
  async function doSync(): Promise<SyncStats> {
    const startTime = Date.now();
    const content = fs.readFileSync(boardPath, 'utf-8');
    const currentHash = computeHash(content);

    if (currentHash === lastHash) {
      logger('📋 board.md unchanged (hash match), skipping sync');
    } else {
      lastHash = currentHash;
      logger('📋 board.md changed but local ticket sync is disabled (provider is source of truth)');
    }

    return {
      syncedAt: new Date(),
      ticketCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Handle file change with debouncing
   */
  function handleChange(_eventPath: string) {
    if (!isRunning) return;

    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new timer
    debounceTimer = setTimeout(async () => {
      try {
        await doSync();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger(`❌ Sync error: ${err.message}`);
        if (onError) {
          onError(err);
        }
      }
    }, debounceMs);
  }

  // Start watching
  watcher = watch(boardPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', handleChange);
  watcher.on('error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger(`❌ Watcher error: ${error.message}`);
    if (onError) {
      onError(error);
    }
  });

  logger(`👀 Watching ${boardPath} for changes...`);

  return {
    stop: async () => {
      isRunning = false;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
      logger('🛑 Watcher stopped');
    },

    syncNow: async () => {
      return doSync();
    },

    isRunning: () => isRunning,
  };
}

/**
 * Run watcher as a foreground process (for CLI command)
 * Uses centralized signal handler for graceful shutdown
 */
export async function runWatcherForeground(
  pmoPath: string,
  storageType: 'sqlite' | 'git',
  options: WatcherOptions = {}
): Promise<void> {
  const watcher = startWatcher(pmoPath, storageType, options);

  // Register cleanup via centralized signal handler
  onShutdown(async () => {
    await watcher.stop();
  });

  // Keep process alive
  await new Promise(() => {
    // Never resolves - runs until signal
  });
}
