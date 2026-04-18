/**
 * Service-Backed Action Handlers
 *
 * Action handlers that call the service/provider layer directly instead of
 * shelling out to prlt CLI commands. These replace the shell-based handlers
 * in actions.ts for actions where a service equivalent exists.
 *
 * The key change: hook → service → DB (in-process, no child process spawn).
 *
 * Handlers that inherently need external processes (spawn-agent, health-check,
 * cleanup-container, etc.) are NOT replaced here — they remain in actions.ts.
 */

import type Database from 'better-sqlite3'
import type { OrchestrateEventContext, OrchestrateActionResult } from './types.js'
import { resolveWorkflowTarget } from '../work-lifecycle/settings.js'
import type { ProviderStorage } from '../providers/types.js'

type AsyncActionHandler = (
  ctx: OrchestrateEventContext,
  config?: Record<string, unknown>,
) => Promise<OrchestrateActionResult>

/**
 * Create a minimal ProviderStorage stub for use with resolveProjectProvider.
 *
 * External providers (Linear, Jira, etc.) don't use storage methods — they go
 * directly to the external API. The local PMO provider does use storage, but
 * it's rarely the active provider when the orchestrate daemon runs (you need
 * an external tracker to have tickets to automate).
 *
 * If a storage method IS called on this stub, it throws so we can diagnose
 * rather than silently misbehave.
 */
function createMinimalStorage(db: Database.Database): ProviderStorage {
  const notImplemented = (method: string) => () => {
    throw new Error(`ProviderStorage.${method}() not available in service-action context`)
  }

  return {
    getTicket: notImplemented('getTicket') as any,
    getProjectBoard: notImplemented('getProjectBoard') as any,
    moveTicket: notImplemented('moveTicket') as any,
    deleteTicket: notImplemented('deleteTicket') as any,
    listTickets: notImplemented('listTickets') as any,
    createTicket: notImplemented('createTicket') as any,
    updateTicket: notImplemented('updateTicket') as any,
    getDatabase: () => db,
  }
}

/**
 * Create service-backed action handlers that use the database and provider
 * layer directly, eliminating shell indirection.
 *
 * Returns a map of action names to async handlers. These override the
 * shell-based equivalents in ACTION_HANDLERS when used by the engine.
 */
export function createServiceActionHandlers(
  db: Database.Database,
): Record<string, AsyncActionHandler> {
  return {
    'move-ticket': createMoveTicketHandler(db),
  }
}

/**
 * Service-backed move-ticket handler.
 *
 * Before: walkPromptChain('prlt ticket move TKT-123 "Done"') — spawns prlt process
 * After:  provider.moveTicket('TKT-123', 'Done') — in-process call to provider API
 */
function createMoveTicketHandler(db: Database.Database): AsyncActionHandler {
  return async (ctx, config) => {
    const start = Date.now()
    if (!ctx.ticket) {
      return { action: 'move-ticket', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    const requestedTarget = (config?.target as string) || 'done'

    try {
      // Resolve intent-like targets (e.g., 'done' → 'Done', 'review' → 'In Review')
      // through the workflow configuration
      const resolvedTarget = resolveWorkflowTarget(db, requestedTarget)

      // Use the provider layer directly — no shell
      const { resolveProjectProvider } = await import('../providers/resolver.js')
      const storage = createMinimalStorage(db)
      const provider = resolveProjectProvider(db, storage, ctx.projectId || '')

      const result = await provider.moveTicket(ctx.ticket, resolvedTarget)

      return {
        action: 'move-ticket',
        success: result.success,
        error: result.error,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        action: 'move-ticket',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}
