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

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SQLiteStorage } from './storage-sqlite.js';
import { parseBoard, generateBoardMarkdown } from './markdown.js';
import { Board } from './types.js';

/**
 * Get the board.md path for a project
 * New structure: pmo/projects/{projectId}/board.md
 */
export function getBoardPath(pmoPath: string, projectId: string): string {
  return path.join(pmoPath, 'projects', projectId, 'board.md');
}

export interface SyncMetadata {
  lastSyncAt: number;      // When we last synced (either direction)
  lastBoardMtime: number;  // board.md mtime at last sync
  lastDbWriteAt: number;   // When CLI last wrote to database
  contentHash?: string;    // SHA-256 hash of board.md content at last sync
}

export interface PMOContext {
  pmoPath: string;
  storage: SQLiteStorage;
  storageType: 'sqlite' | 'git';
}

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get sync metadata from database
 */
export function getSyncMetadata(storage: SQLiteStorage): SyncMetadata | null {
  const meta = storage.getCacheMetadata();
  if (!meta) return null;

  return {
    lastSyncAt: meta.cacheBuiltAt,
    lastBoardMtime: meta.boardMtime,
    lastDbWriteAt: meta.cacheBuiltAt,
    contentHash: meta.contentHash,
  };
}

/**
 * Update sync metadata after a sync operation
 */
export function updateSyncMetadata(
  storage: SQLiteStorage,
  boardMtime: number,
  contentHash?: string
): void {
  storage.setCacheMetadata({
    boardMtime,
    cacheBuiltAt: Date.now(),
    contentHash,
  });
}

/**
 * Check if board.md mtime has changed (fast check)
 */
export function boardMtimeChanged(pmoPath: string, storage: SQLiteStorage, projectId: string = 'default'): boolean {
  const boardPath = getBoardPath(pmoPath, projectId);

  if (!fs.existsSync(boardPath)) {
    return false;
  }

  const stats = fs.statSync(boardPath);
  const meta = getSyncMetadata(storage);

  if (!meta) {
    // No sync metadata - board.md exists but never synced
    return true;
  }

  // board.md mtime differs from last sync
  return stats.mtimeMs !== meta.lastBoardMtime;
}

/**
 * Check if board.md content has actually changed (slower, content-based check)
 * Only called when mtime indicates a potential change
 */
export function boardContentChanged(
  pmoPath: string,
  storage: SQLiteStorage,
  content: string
): boolean {
  const meta = getSyncMetadata(storage);

  if (!meta || !meta.contentHash) {
    // No content hash stored - assume changed
    return true;
  }

  const currentHash = computeHash(content);
  return currentHash !== meta.contentHash;
}

/**
 * Auto-sync from board.md if it has changes
 * Uses hybrid mtime + content approach:
 * 1. If mtime unchanged -> skip (fast path)
 * 2. If mtime changed -> check content hash
 * 3. If content same -> just update mtime, skip sync
 * 4. If content different -> perform sync
 *
 * Returns: true if sync performed, false otherwise
 */
export function autoSyncFromBoard(
  pmoPath: string,
  storage: SQLiteStorage,
  logger?: (msg: string) => void,
  projectId: string = 'default'
): boolean {
  const boardPath = getBoardPath(pmoPath, projectId);

  if (!fs.existsSync(boardPath)) {
    return false;
  }

  // Fast path: mtime unchanged
  if (!boardMtimeChanged(pmoPath, storage, projectId)) {
    return false;
  }

  // Mtime changed - read content and check hash
  const markdown = fs.readFileSync(boardPath, 'utf-8');
  const stats = fs.statSync(boardPath);
  const contentHash = computeHash(markdown);

  // Check if content actually changed
  if (!boardContentChanged(pmoPath, storage, markdown)) {
    // Content same, just update mtime (file was touched but not modified)
    updateSyncMetadata(storage, stats.mtimeMs, contentHash);
    if (logger) {
      logger(`📋 ${path.basename(boardPath)} touched but unchanged, updated mtime`);
    }
    return false;
  }

  // Content changed - perform full sync
  const board = parseBoard(markdown, projectId);
  storage.rebuildFromBoard(board);

  // Update sync metadata with new mtime and hash
  updateSyncMetadata(storage, stats.mtimeMs, contentHash);

  if (logger) {
    logger(`📥 Auto-synced from ${path.basename(boardPath)}`);
  }

  return true;
}

/**
 * Auto-export database to board.md after write operations
 */
export async function autoExportToBoard(
  pmoPath: string,
  storage: SQLiteStorage,
  logger?: (msg: string) => void,
  projectId?: string
): Promise<void> {
  const pid = projectId ?? storage.getCurrentProjectId();
  const boardPath = getBoardPath(pmoPath, pid);

  // Generate markdown from current database state
  const markdown = await storage.getBoardMarkdown();

  // Write to board.md
  fs.writeFileSync(boardPath, markdown);

  // Update sync metadata with new mtime and content hash
  const stats = fs.statSync(boardPath);
  const contentHash = computeHash(markdown);
  updateSyncMetadata(storage, stats.mtimeMs, contentHash);

  if (logger) {
    logger(`📤 Auto-exported to ${path.basename(boardPath)}`);
  }
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
  storageType: 'sqlite' | 'git',
  logger?: (msg: string) => void,
  projectId: string = 'default'
): SQLiteStorage {
  // Storage is always workspace.db (unified PMO tables with foreign keys to agents)
  const dbPath = getWorkspaceDbPath(pmoPath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run 'prlt init' first.`);
  }

  const storage = new SQLiteStorage(dbPath, projectId);

  // Auto-sync if board.md has changes
  autoSyncFromBoard(pmoPath, storage, logger, projectId);

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
