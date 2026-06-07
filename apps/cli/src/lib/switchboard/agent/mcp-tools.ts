/**
 * Switchboard Agent MCP Tools
 *
 * MCP tool registrars that give agents access to the switchboard.
 * Injected at spawn time via the agent startup script.
 *
 * Tools:
 * - switchboard_reply: respond to a call message
 * - switchboard_cast: fire-and-forget message to another address
 * - switchboard_subscribe: subscribe to event topics
 * - switchboard_status: query switchboard state
 *
 * See: PRLT-1371
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SwitchboardClient } from '../client.js'
import type { SwitchboardAddress, SwitchboardAddressKind } from '../types.js'

// =============================================================================
// Types
// =============================================================================

export interface SwitchboardMcpContext {
  /** The switchboard client for this agent. */
  client: SwitchboardClient
}

// =============================================================================
// Tool Registration
// =============================================================================

/**
 * Register all switchboard MCP tools on the given server.
 */
export function registerSwitchboardTools(server: McpServer, ctx: SwitchboardMcpContext): void {
  registerReplyTool(server, ctx)
  registerCastTool(server, ctx)
  registerSubscribeTool(server, ctx)
  registerStatusTool(server, ctx)
  registerPollTool(server, ctx)
}

// =============================================================================
// Individual Tools
// =============================================================================

const addressKindSchema = z.enum([
  'session', 'agent', 'daemon', 'orchestrator', 'gateway', 'cli', 'topic',
])

function registerReplyTool(server: McpServer, ctx: SwitchboardMcpContext): void {
  const schema = z.object({
    correlation_id: z.string().describe('The message ID of the call to reply to'),
    to_kind: addressKindSchema.describe('The kind of the caller address'),
    to_id: z.string().describe('The ID of the caller'),
    type: z.string().describe('Reply message type'),
    payload: z.string().describe('JSON payload for the reply'),
  }).strict()

  server.registerTool('switchboard_reply', {
    description: 'Reply to a switchboard call message. Use this when you receive a call (request) and need to send back a response.',
    inputSchema: schema,
  }, (params) => {
    try {
      const to: SwitchboardAddress = {
        kind: params.to_kind as SwitchboardAddressKind,
        id: params.to_id,
      }
      const payload = safeParseJson(params.payload)
      const msg = ctx.client.reply(params.correlation_id, to, params.type, payload)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, messageId: msg.id }, null, 2),
        }],
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      }
    }
  })
}

function registerCastTool(server: McpServer, ctx: SwitchboardMcpContext): void {
  const schema = z.object({
    to_kind: addressKindSchema.describe('The kind of the recipient address'),
    to_id: z.string().describe('The ID of the recipient'),
    type: z.string().describe('Message type'),
    payload: z.string().describe('JSON payload'),
    ttl_seconds: z.number().optional().describe('Time-to-live in seconds (default: 3600)'),
  }).strict()

  server.registerTool('switchboard_cast', {
    description: 'Send a fire-and-forget message to another switchboard address. The message is delivered at-least-once with a default 1-hour TTL.',
    inputSchema: schema,
  }, (params) => {
    try {
      const to: SwitchboardAddress = {
        kind: params.to_kind as SwitchboardAddressKind,
        id: params.to_id,
      }
      const payload = safeParseJson(params.payload)
      const msg = ctx.client.cast({
        from: ctx.client.address,
        to,
        type: params.type,
        payload,
        ttlSeconds: params.ttl_seconds,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, messageId: msg.id }, null, 2),
        }],
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      }
    }
  })
}

function registerSubscribeTool(server: McpServer, ctx: SwitchboardMcpContext): void {
  const schema = z.object({
    topic: z.string().describe('The event topic to subscribe to (e.g. "agent:spawned", "work:pr_merged")'),
    action: z.enum(['subscribe', 'unsubscribe']).describe('Whether to subscribe or unsubscribe'),
  }).strict()

  server.registerTool('switchboard_subscribe', {
    description: 'Subscribe or unsubscribe from switchboard event topics. Subscribed topics will deliver event messages to this agent.',
    inputSchema: schema,
  }, (params) => {
    try {
      if (params.action === 'subscribe') {
        const sub = ctx.client.subscribe(params.topic)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              subscriptionId: sub.id,
              topic: sub.topic,
            }, null, 2),
          }],
        }
      } else {
        ctx.client.unsubscribe(params.topic)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, unsubscribed: params.topic }, null, 2),
          }],
        }
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      }
    }
  })
}

function registerStatusTool(server: McpServer, ctx: SwitchboardMcpContext): void {
  const schema = z.object({}).strict()

  server.registerTool('switchboard_status', {
    description: 'Get the current switchboard status — message counts, subscriptions, and connection state.',
    inputSchema: schema,
  }, () => {
    try {
      const status = ctx.client.status()
      const subscriptions = ctx.client.listSubscriptions()

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            address: status.address,
            connected: status.connected,
            messageCounts: status.messageCounts,
            subscriptions: subscriptions.map(s => ({
              id: s.id,
              topic: s.topic,
              active: s.active,
            })),
          }, null, 2),
        }],
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      }
    }
  })
}

function registerPollTool(server: McpServer, ctx: SwitchboardMcpContext): void {
  const schema = z.object({
    limit: z.number().optional().describe('Maximum messages to retrieve (default: 10)'),
  }).strict()

  server.registerTool('switchboard_poll', {
    description: 'Poll for pending switchboard messages addressed to this agent. Returns and acknowledges pending messages.',
    inputSchema: schema,
  }, () => {
    try {
      const messages = ctx.client.poll(10)
      const events = ctx.client.pollEvents()
      const all = [...messages, ...events]

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            count: all.length,
            messages: all.map(m => ({
              id: m.id,
              pattern: m.pattern,
              from: m.from,
              type: m.type,
              payload: safeParseJson(m.payload),
              correlationId: m.correlationId,
              topic: m.topic,
              createdAt: m.createdAt,
            })),
          }, null, 2),
        }],
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      }
    }
  })
}

// =============================================================================
// Helpers
// =============================================================================

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}
