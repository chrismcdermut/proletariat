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
import { interpolateTemplate } from '../work-lifecycle/hooks/types.js'

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
  'poke-orchestrator',
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
    'poke-orchestrator': createPokeHandler(),
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

/**
 * Service-backed poke handler (poke-orchestrator action).
 *
 * Sends a templated message to a named session via tmux. The target session
 * and message template come from the hook's config JSON:
 *
 *   config: { target: 'orchestrator-main', template: '{event}: {ticket_id} — {summary}' }
 *
 * If no template is provided, generates a default message with event name,
 * ticket ID, PR number, and a suggested next command.
 */
function createPokeHandler(): ServiceActionHandler {
  return async (ctx, config) => {
    const start = Date.now()
    const target = (config?.target as string) || 'orchestrator-main'
    const template = config?.template as string | undefined

    // Build the message from template or default
    let message: string
    if (template) {
      message = interpolateTemplate(template, ctx)
    } else {
      // Default message with event name, ticket, PR, and suggested next command
      const parts: string[] = [`[${ctx.event || 'unknown'}]`]
      if (ctx.ticket) parts.push(`ticket=${ctx.ticket}`)
      if (ctx.pr) parts.push(`PR=#${ctx.pr}`)
      if (ctx.agent) parts.push(`agent=${ctx.agent}`)

      // Suggest a next command based on the event
      const suggested = suggestNextCommand(ctx.event as string, ctx)
      if (suggested) parts.push(`→ ${suggested}`)

      message = parts.join(' ')
    }

    try {
      // Import session resolution and tmux utilities lazily to avoid circular deps
      const { SessionService } = await import('../../services/session-service.js')
      const { sendTmuxMessage } = await import('../execution/session-utils.js')

      const sessionService = new SessionService()
      const resolved = sessionService.resolveSession(target)

      if (resolved.kind === 'none') {
        // Session not found — log the message instead of failing
        console.log(`[poke-orchestrator] Session "${target}" not found. Message: ${message}`)
        return { action: 'poke-orchestrator', success: true, durationMs: Date.now() - start }
      }

      if (resolved.kind === 'multiple') {
        console.log(`[poke-orchestrator] Multiple sessions match "${target}". Message: ${message}`)
        return { action: 'poke-orchestrator', success: true, durationMs: Date.now() - start }
      }

      const session = resolved.session
      sendTmuxMessage(session.sessionId, message, session.containerId)

      return { action: 'poke-orchestrator', success: true, durationMs: Date.now() - start }
    } catch (err) {
      // Poke failures are non-fatal — the orchestrator may not be running
      console.log(`[poke-orchestrator] Failed to poke "${target}": ${err instanceof Error ? err.message : String(err)}. Message: ${message}`)
      return { action: 'poke-orchestrator', success: true, durationMs: Date.now() - start }
    }
  }
}

/**
 * Suggest a next prlt command based on the event type.
 */
function suggestNextCommand(event: string, ctx: Record<string, unknown>): string | undefined {
  switch (event) {
    case 'on_pr_opened':
      return ctx.pr ? `prlt work ship ${ctx.ticket || ''}` : undefined
    case 'on_ci_green':
      return ctx.pr ? `prlt work ship ${ctx.ticket || ''}` : undefined
    case 'on_ci_failed':
      return ctx.ticket ? `prlt work start ${ctx.ticket} --action fix` : undefined
    case 'on_agent_completed':
      return ctx.ticket ? `prlt work propose ${ctx.ticket}` : undefined
    case 'on_agent_died':
      return ctx.ticket ? `prlt work start ${ctx.ticket}` : undefined
    default:
      return undefined
  }
}
