/**
 * Service-Backed Action Handlers
 *
 * Action handlers that call the service/provider layer directly instead of
 * shelling out to prlt CLI commands. These replace the shell-based handlers
 * in actions.ts for actions where a service equivalent exists.
 *
 * The key change: hook → service → DB (in-process, no child process spawn).
 *
 * Actions that inherently need external processes (spawn-agent, health-check,
 * cleanup-container, etc.) are NOT replaced here — they remain in actions.ts.
 */

import type Database from 'better-sqlite3'
import type { OrchestrateEventContext, OrchestrateActionResult } from './types.js'
import { resolveWorkflowTarget } from '../work-lifecycle/settings.js'
import type { ProviderStorage } from '../providers/types.js'

type ServiceActionHandler = (
  ctx: OrchestrateEventContext,
  config?: Record<string, unknown>,
) => Promise<OrchestrateActionResult>

/**
 * Create a minimal ProviderStorage for use with resolveProjectProvider.
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
    getTicket: notImplemented('getTicket') as never,
    getProjectBoard: notImplemented('getProjectBoard') as never,
    moveTicket: notImplemented('moveTicket') as never,
    deleteTicket: notImplemented('deleteTicket') as never,
    listTickets: notImplemented('listTickets') as never,
    createTicket: notImplemented('createTicket') as never,
    updateTicket: notImplemented('updateTicket') as never,
    getDatabase: () => db,
  }
}

/**
 * Actions that have service-backed replacements.
 * Other actions (spawn-agent, health-check, etc.) still use shell execution.
 */
export const SERVICE_BACKED_ACTIONS = new Set([
  'move-ticket',
  'notify',
])

/**
 * Create service-backed action handlers that use the database and provider
 * layer directly, eliminating shell indirection.
 *
 * Returns a map of action names to async handlers. These override the
 * shell-based equivalents in ACTION_HANDLERS when the hook's action_type
 * is 'action'.
 */
export function createServiceActionHandlers(
  db: Database.Database,
): Record<string, ServiceActionHandler> {
  return {
    'move-ticket': createMoveTicketHandler(db),
    'notify': createNotifyHandler(),
  }
}

/**
 * Service-backed move-ticket handler.
 *
 * Before: walkPromptChain('prlt ticket move TKT-123 "Done"') — spawns prlt process
 * After:  provider.moveTicket('TKT-123', 'Done') — in-process call to provider API
 */
function createMoveTicketHandler(db: Database.Database): ServiceActionHandler {
  return async (ctx, config) => {
    const start = Date.now()
    if (!ctx.ticket) {
      return { action: 'move-ticket', success: false, error: 'No ticket in context', durationMs: Date.now() - start }
    }

    const requestedTarget = (config?.target as string) || 'done'

    try {
      const resolvedTarget = resolveWorkflowTarget(db, requestedTarget)

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

/**
 * Service-backed notify handler.
 *
 * Before: shelling out to prlt or console.log via actions.ts
 * After:  dispatches through NotificationManager in-process
 */
function createNotifyHandler(): ServiceActionHandler {
  return async (ctx) => {
    const start = Date.now()

    try {
      const { getNotificationManager } = await import('../notifications/index.js')
      const manager = getNotificationManager()
      if (manager) {
        const notifCtx = { ...ctx, event: ctx.event || 'notify' }
        await manager.fireEvent(notifCtx.event, notifCtx)
        return { action: 'notify', success: true, durationMs: Date.now() - start }
      }
    } catch {
      // Notification layer not available — fall through to terminal
    }

    const parts: string[] = []
    if (ctx.event) parts.push(`[${ctx.event}]`)
    if (ctx.ticket) parts.push(`ticket=${ctx.ticket}`)
    if (ctx.pr) parts.push(`PR=#${ctx.pr}`)
    if (ctx.agent) parts.push(`agent=${ctx.agent}`)
    console.log(`[orchestrate:notify] ${parts.join(' ')}`)

    return { action: 'notify', success: true, durationMs: Date.now() - start }
  }
}
