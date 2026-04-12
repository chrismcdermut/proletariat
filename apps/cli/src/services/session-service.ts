/**
 * SessionService
 *
 * Service for querying and managing agent sessions machine-wide.
 * Sessions are collected from workspace.db, machine.db, and tmux/Docker
 * discovery, then grouped by HQ for display.
 *
 * The collection logic lives in lib/session/renderer.ts — this service
 * provides a clean interface for CLI, web, and LLM consumers.
 */

import {
  collectAllSessions,
  groupSessionsByHQ,
  bucketElsewhereByHq,
} from '../lib/session/renderer.js'
import type {
  UnifiedSession,
  CollectOptions,
  GroupedSessions,
  SessionRole,
} from '../lib/session/renderer.js'
import { ServiceError } from './types.js'
import type { ListSessionsOptions, ListSessionsResult } from './types.js'

export class SessionService {
  /**
   * List all sessions on the machine, optionally filtered.
   *
   * Returns both the flat session list and grouped-by-HQ structure.
   */
  listSessions(options: ListSessionsOptions = {}): ListSessionsResult {
    try {
      const sessions = collectAllSessions({
        hqPathFilter: options.hqPathFilter,
        roleFilter: options.roleFilter,
        includeAll: options.includeAll,
      })

      const grouped = groupSessionsByHQ(sessions)

      return {
        success: true,
        sessions,
        grouped,
      }
    } catch (error) {
      throw new ServiceError(
        'INTERNAL',
        `Failed to collect sessions: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Group "elsewhere" sessions by their HQ for display.
   */
  bucketByHq(sessions: UnifiedSession[]): Array<{ hqPath: string | null; hqName: string; sessions: UnifiedSession[] }> {
    return bucketElsewhereByHq(sessions)
  }

  /**
   * Get sessions for a specific role.
   */
  getSessionsByRole(role: SessionRole, options: CollectOptions = {}): UnifiedSession[] {
    return collectAllSessions({ ...options, roleFilter: role })
  }

  /**
   * Check if a specific session is alive (exists in the collected sessions).
   */
  isSessionAlive(sessionId: string): boolean {
    const sessions = collectAllSessions()
    return sessions.some(s => s.sessionId === sessionId && s.exists)
  }
}
