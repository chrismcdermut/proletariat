/**
 * PR Merge Sync
 *
 * Polls GitHub for merged PRs and auto-moves linked tickets to Done.
 * This is the core logic shared by:
 * - `prlt pr sync` command (explicit sync)
 * - oclif postrun hook (automatic background sync)
 *
 * The sync checks all tickets with linked PRs that aren't already in a
 * completed state. For each, it queries GitHub for the PR status and
 * moves merged tickets to Done, emitting work:pr_merged events for
 * outbound sync to external providers (e.g., Linear).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { getPRByNumber, getGitHubRepo, isGHInstalled, isGHAuthenticated } from './index.js';
import { getWorkColumnSetting, findColumnByName } from '../pmo/utils.js';
import { getEventBus } from '../events/event-bus.js';
import type { SQLiteStorage } from '../pmo/storage-sqlite.js';

export interface SyncResult {
  ticketId: string;
  title: string;
  prNumber: number;
}

export interface SyncError {
  ticketId: string;
  error: string;
}

export interface SyncMergedPRsResult {
  synced: SyncResult[];
  errors: SyncError[];
}

/**
 * Check all tickets with linked PRs and auto-move merged ones to Done.
 *
 * @param storage - PMO storage instance
 * @param db - Database instance for settings
 * @param options.dryRun - If true, only report what would be synced
 * @param options.resolveProvider - Optional function to resolve ticket provider for external sync
 * @returns Summary of synced tickets and any errors
 */
export async function syncMergedPRs(
  storage: SQLiteStorage,
  db: Database.Database,
  options?: {
    dryRun?: boolean;
    resolveProvider?: (ticketId: string, projectId: string) => Promise<{
      name: string;
      moveTicket: (ticketId: string, column: string) => Promise<{ success: boolean; provider?: string }>;
    }>;
  },
): Promise<SyncMergedPRsResult> {
  const synced: SyncResult[] = [];
  const errors: SyncError[] = [];

  if (!isGHInstalled() || !isGHAuthenticated()) {
    return { synced, errors };
  }

  const projects = await storage.listProjects();

  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop -- Sequential project iteration
    const tickets = await storage.listTickets(project.id);

    // Find tickets with linked PRs not yet marked as merged and not completed
    const ticketsWithPRs = tickets.filter(t =>
      t.metadata?.pr_number &&
      t.metadata?.pr_state !== 'MERGED' &&
      t.statusCategory !== 'completed'
    );

    for (const ticket of ticketsWithPRs) {
      const prNumber = parseInt(ticket.metadata!.pr_number!, 10);
      if (!prNumber) continue;

      // Query GitHub for PR status
      const prInfo = getPRByNumber(prNumber);
      if (!prInfo || prInfo.state !== 'MERGED') continue;

      if (options?.dryRun) {
        synced.push({ ticketId: ticket.id, title: ticket.title, prNumber });
        continue;
      }

      try {
        // Update ticket metadata with merged state
        // eslint-disable-next-line no-await-in-loop -- Sequential updates
        await storage.updateTicket(ticket.id, {
          metadata: {
            ...ticket.metadata,
            pr_state: 'MERGED',
          },
        });

        // Move ticket to Done column
        const targetColumnName = getWorkColumnSetting(db, 'done');
        // eslint-disable-next-line no-await-in-loop -- Sequential board lookup
        const board = ticket.projectId
          ? await storage.getProjectBoard(ticket.projectId)
          : null;
        const columnNames = board ? board.columns.map(col => col.name) : [];
        const doneColumn = findColumnByName(columnNames, targetColumnName);

        if (doneColumn && ticket.projectId) {
          // Move in local PMO
          // eslint-disable-next-line no-await-in-loop -- Sequential move
          await storage.moveTicket(ticket.projectId, ticket.id, doneColumn);

          // Sync to external provider if available
          if (options?.resolveProvider) {
            try {
              // eslint-disable-next-line no-await-in-loop -- Sequential provider sync
              const provider = await options.resolveProvider(ticket.id, ticket.projectId);
              if (provider.name !== 'pmo') {
                // eslint-disable-next-line no-await-in-loop -- Sequential provider sync
                await provider.moveTicket(ticket.id, doneColumn);
              }
            } catch {
              // Non-critical
            }
          }
        }

        // Emit work:pr_merged event for outbound sync
        try {
          const repo = getGitHubRepo();
          const prUrl = repo ? `https://github.com/${repo}/pull/${prNumber}` : ticket.metadata?.pr_url ?? null;

          getEventBus().emit('work:pr_merged', {
            workItemId: ticket.id,
            source: 'github',
            projectId: ticket.projectId,
            prNumber,
            prTitle: prInfo.title,
            prUrl,
            mergeMethod: 'unknown',
            timestamp: new Date(),
          });
        } catch {
          // Non-critical
        }

        synced.push({ ticketId: ticket.id, title: ticket.title, prNumber });
      } catch (err) {
        errors.push({
          ticketId: ticket.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { synced, errors };
}

// =============================================================================
// Debounce / Last-Run Tracking
// =============================================================================

const SYNC_INTERVAL_KEY = 'pr_sync_last_run';
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if enough time has passed since the last auto-sync.
 * Uses pmo_settings to persist the last-run timestamp.
 */
export function shouldAutoSync(db: Database.Database, intervalMs: number = DEFAULT_SYNC_INTERVAL_MS): boolean {
  try {
    const row = db.prepare(
      `SELECT value FROM pmo_settings WHERE key = ?`
    ).get(SYNC_INTERVAL_KEY) as { value: string } | undefined;

    if (!row) return true;

    const lastRun = parseInt(row.value, 10);
    return Date.now() - lastRun >= intervalMs;
  } catch {
    return false;
  }
}

/**
 * Record that an auto-sync just ran.
 */
export function recordAutoSync(db: Database.Database): void {
  try {
    db.prepare(`
      INSERT INTO pmo_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(SYNC_INTERVAL_KEY, String(Date.now()), String(Date.now()));
  } catch {
    // Non-fatal
  }
}

// =============================================================================
// Postrun Hook Integration
// =============================================================================

/**
 * Auto-sync merged PRs from the postrun hook.
 *
 * This is a fire-and-forget operation called after every CLI command.
 * It is debounced (at most once per 5 minutes) and fully non-blocking.
 * If the workspace DB or GitHub CLI is not available, it silently no-ops.
 */
export async function autoSyncMergedPRs(): Promise<void> {
  // Quick-fail checks before opening any DB
  if (!isGHInstalled() || !isGHAuthenticated()) return;

  // Find workspace.db by walking up from cwd
  let dbPath: string | null = null;
  try {
    let dir = process.cwd();
    while (dir !== '/') {
      const candidate = `${dir}/.proletariat/workspace.db`;
      if (fs.existsSync(candidate)) {
        dbPath = candidate;
        break;
      }
      // Also check for pmo/ directory which indicates a workspace
      const pmoCandidate = `${dir}/pmo`;
      if (fs.existsSync(pmoCandidate) && fs.existsSync(`${dir}/.proletariat/workspace.db`)) {
        dbPath = `${dir}/.proletariat/workspace.db`;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    return;
  }

  if (!dbPath || !fs.existsSync(dbPath)) return;

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);

    // Debounce: skip if we ran recently
    if (!shouldAutoSync(db)) {
      db.close();
      return;
    }

    // Dynamically import SQLiteStorage to avoid circular dependencies
    const { SQLiteStorage } = await import('../pmo/storage-sqlite.js');
    const storage = new SQLiteStorage(dbPath);

    try {
      await syncMergedPRs(storage, db);
      recordAutoSync(db);
    } finally {
      await storage.close();
    }
  } catch {
    // Fully non-fatal — never break the CLI
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}
