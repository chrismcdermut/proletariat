/**
 * PMO Board Watcher
 *
 * PRLT-1299: Board watching is dead code. The database is the sole source
 * of truth; board.md syncing has been removed. These are minimal stubs
 * that preserve the exported interface for backward compatibility.
 */

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
 * Start watching kanban.md for changes
 *
 * PRLT-1299: No-op stub. Board watching is disabled.
 */
export function startWatcher(
  _pmoPath: string,
  _storageType: 'sqlite' | 'git',
  _options: WatcherOptions = {},
  _projectId?: string
): WatcherInstance {
  return {
    stop: async () => {},
    syncNow: async () => ({
      syncedAt: new Date(),
      ticketCount: 0,
      durationMs: 0,
    }),
    isRunning: () => false,
  };
}

/**
 * Run watcher as a foreground process (for CLI command)
 *
 * PRLT-1299: No-op stub. Board watching is disabled.
 */
export async function runWatcherForeground(
  _pmoPath: string,
  _storageType: 'sqlite' | 'git',
  _options: WatcherOptions = {}
): Promise<void> {
  // No-op: board watching disabled (PRLT-1299)
}
