/**
 * Gateway Message Formatter — Platform-aware rich message formatting.
 *
 * Converts structured MessageBlocks into platform-specific formats:
 * - Slack: Block Kit JSON
 * - Discord: Markdown with embeds
 * - WhatsApp: Plain text with limited formatting
 *
 * See: PRLT-1372
 */

import type {
  GatewayPlatform,
  MessageBlock,
  OutboundMessage,
  StatusCardBlock,
} from './types.js'

// =============================================================================
// Slack Formatting
// =============================================================================

/**
 * Format blocks into Slack Block Kit JSON structures.
 * See: https://api.slack.com/reference/block-kit/blocks
 */
export function formatSlackBlocks(blocks: MessageBlock[]): unknown[] {
  const slackBlocks: unknown[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        slackBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: block.content },
        })
        break

      case 'code':
        slackBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${block.content}\`\`\``,
          },
        })
        break

      case 'link':
        slackBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: block.label ? `<${block.url}|${block.label}>` : `<${block.url}>`,
          },
        })
        break

      case 'status_card':
        slackBlocks.push(formatSlackStatusCard(block))
        break

      case 'divider':
        slackBlocks.push({ type: 'divider' })
        break
    }
  }

  return slackBlocks
}

function formatSlackStatusCard(card: StatusCardBlock): unknown {
  const emoji = statusEmoji(card.status)
  const fields = card.fields.map(f => ({
    type: 'mrkdwn',
    text: `*${f.label}:*\n${f.value}`,
  }))

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: `${emoji} *${card.title}*` },
    fields,
  }
}

// =============================================================================
// Discord Formatting
// =============================================================================

/**
 * Format blocks into Discord markdown with optional embeds.
 * Discord uses standard markdown with some extensions.
 */
export function formatDiscordContent(blocks: MessageBlock[]): {
  content: string
  embeds: unknown[]
} {
  const parts: string[] = []
  const embeds: unknown[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.content)
        break

      case 'code':
        parts.push(`\`\`\`${block.language ?? ''}\n${block.content}\n\`\`\``)
        break

      case 'link':
        parts.push(block.label ? `[${block.label}](${block.url})` : block.url)
        break

      case 'status_card':
        embeds.push(formatDiscordEmbed(block))
        break

      case 'divider':
        parts.push('---')
        break
    }
  }

  return { content: parts.join('\n'), embeds }
}

function formatDiscordEmbed(card: StatusCardBlock): unknown {
  const colorMap: Record<string, number> = {
    success: 0x22c55e,    // green
    failure: 0xef4444,    // red
    warning: 0xf59e0b,    // amber
    info: 0x3b82f6,       // blue
    in_progress: 0x8b5cf6, // purple
  }

  return {
    title: `${statusEmoji(card.status)} ${card.title}`,
    color: colorMap[card.status] ?? 0x6b7280,
    fields: card.fields.map(f => ({
      name: f.label,
      value: f.value,
      inline: true,
    })),
  }
}

// =============================================================================
// WhatsApp Formatting
// =============================================================================

/**
 * Format blocks into WhatsApp plain text.
 * WhatsApp supports limited formatting: *bold*, _italic_, ~strike~, ```code```.
 */
export function formatWhatsAppText(blocks: MessageBlock[]): string {
  const parts: string[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.content)
        break

      case 'code':
        parts.push(`\`\`\`${block.content}\`\`\``)
        break

      case 'link':
        parts.push(block.label ? `${block.label}: ${block.url}` : block.url)
        break

      case 'status_card':
        parts.push(formatWhatsAppStatusCard(block))
        break

      case 'divider':
        parts.push('---')
        break
    }
  }

  return parts.join('\n\n')
}

function formatWhatsAppStatusCard(card: StatusCardBlock): string {
  const emoji = statusEmoji(card.status)
  const header = `${emoji} *${card.title}*`
  const fields = card.fields.map(f => `${f.label}: ${f.value}`).join('\n')
  return `${header}\n${fields}`
}

// =============================================================================
// Message Conversion
// =============================================================================

/**
 * Format an OutboundMessage for a specific platform.
 *
 * Returns a platform-specific payload ready for the adapter to send.
 * If the message has no blocks, falls back to plain text.
 */
export function formatOutboundMessage(message: OutboundMessage): {
  text: string
  platformPayload: unknown
} {
  if (!message.blocks || message.blocks.length === 0) {
    return {
      text: message.text,
      platformPayload: null,
    }
  }

  switch (message.platform) {
    case 'slack':
      return {
        text: message.text,
        platformPayload: { blocks: formatSlackBlocks(message.blocks) },
      }

    case 'discord': {
      const { content, embeds } = formatDiscordContent(message.blocks)
      return {
        text: content || message.text,
        platformPayload: { embeds },
      }
    }

    case 'whatsapp':
      return {
        text: formatWhatsAppText(message.blocks),
        platformPayload: null,
      }
  }
}

// =============================================================================
// Routing Parser
// =============================================================================

/**
 * Parse a message to extract routing targets.
 *
 * Supported patterns:
 * - "@agent-name <message>" → direct message to agent by name
 * - "#PRLT-123 <message>" → direct message to agent working ticket
 * - No prefix → broadcast to all agents
 */
export function parseMessageTarget(text: string): {
  mode: 'direct' | 'broadcast'
  agentId?: string
  ticketId?: string
  cleanText: string
} {
  // Match @agent-name at the start of the message
  const agentMatch = text.match(/^@([\w-]+)\s+(.*)$/s)
  if (agentMatch) {
    return {
      mode: 'direct',
      agentId: agentMatch[1],
      cleanText: agentMatch[2].trim(),
    }
  }

  // Match #TICKET-ID at the start of the message
  const ticketMatch = text.match(/^#([\w-]+)\s+(.*)$/s)
  if (ticketMatch) {
    return {
      mode: 'direct',
      ticketId: ticketMatch[1],
      cleanText: ticketMatch[2].trim(),
    }
  }

  // Default: broadcast
  return {
    mode: 'broadcast',
    cleanText: text.trim(),
  }
}

// =============================================================================
// Helpers
// =============================================================================

function statusEmoji(status: string): string {
  switch (status) {
    case 'success': return '[OK]'
    case 'failure': return '[FAIL]'
    case 'warning': return '[WARN]'
    case 'info': return '[INFO]'
    case 'in_progress': return '[WIP]'
    default: return '[?]'
  }
}
