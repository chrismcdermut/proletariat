import { expect } from 'chai'
import {
  formatSlackBlocks,
  formatDiscordContent,
  formatWhatsAppText,
  formatOutboundMessage,
  parseMessageTarget,
} from '../../../../src/lib/switchboard/gateway/formatter.js'
import type { MessageBlock, OutboundMessage } from '../../../../src/lib/switchboard/gateway/types.js'

describe('Gateway Formatter', () => {
  // ===========================================================================
  // formatSlackBlocks()
  // ===========================================================================

  describe('formatSlackBlocks()', () => {
    it('formats text blocks as mrkdwn sections', () => {
      const blocks: MessageBlock[] = [{ type: 'text', content: 'Hello world' }]
      const result = formatSlackBlocks(blocks)

      expect(result).to.have.length(1)
      expect(result[0]).to.deep.equal({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Hello world' },
      })
    })

    it('formats code blocks with triple backticks', () => {
      const blocks: MessageBlock[] = [{ type: 'code', content: 'const x = 1' }]
      const result = formatSlackBlocks(blocks)

      expect(result).to.have.length(1)
      const section = result[0] as { type: string; text: { text: string } }
      expect(section.text.text).to.equal('```const x = 1```')
    })

    it('formats link blocks with Slack link syntax', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com', label: 'Example' },
      ]
      const result = formatSlackBlocks(blocks)

      const section = result[0] as { type: string; text: { text: string } }
      expect(section.text.text).to.equal('<https://example.com|Example>')
    })

    it('formats link blocks without label', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com' },
      ]
      const result = formatSlackBlocks(blocks)

      const section = result[0] as { type: string; text: { text: string } }
      expect(section.text.text).to.equal('<https://example.com>')
    })

    it('formats divider blocks', () => {
      const blocks: MessageBlock[] = [{ type: 'divider' }]
      const result = formatSlackBlocks(blocks)

      expect(result).to.deep.equal([{ type: 'divider' }])
    })

    it('formats status card blocks with emoji and fields', () => {
      const blocks: MessageBlock[] = [{
        type: 'status_card',
        title: 'Build',
        status: 'success',
        fields: [
          { label: 'Branch', value: 'main' },
          { label: 'Time', value: '2m 30s' },
        ],
      }]
      const result = formatSlackBlocks(blocks)

      expect(result).to.have.length(1)
      const section = result[0] as Record<string, unknown>
      expect(section.type).to.equal('section')

      const text = section.text as { text: string }
      expect(text.text).to.include('[OK]')
      expect(text.text).to.include('*Build*')

      const fields = section.fields as Array<{ text: string }>
      expect(fields).to.have.length(2)
      expect(fields[0].text).to.include('Branch')
      expect(fields[1].text).to.include('Time')
    })

    it('handles multiple block types together', () => {
      const blocks: MessageBlock[] = [
        { type: 'text', content: 'Header' },
        { type: 'divider' },
        { type: 'code', content: 'x = 1' },
        { type: 'link', url: 'https://example.com' },
      ]
      const result = formatSlackBlocks(blocks)

      expect(result).to.have.length(4)
    })
  })

  // ===========================================================================
  // formatDiscordContent()
  // ===========================================================================

  describe('formatDiscordContent()', () => {
    it('formats text blocks as plain content', () => {
      const blocks: MessageBlock[] = [{ type: 'text', content: 'Hello world' }]
      const { content, embeds } = formatDiscordContent(blocks)

      expect(content).to.equal('Hello world')
      expect(embeds).to.have.length(0)
    })

    it('formats code blocks with language annotation', () => {
      const blocks: MessageBlock[] = [{ type: 'code', content: 'const x = 1', language: 'typescript' }]
      const { content } = formatDiscordContent(blocks)

      expect(content).to.equal('```typescript\nconst x = 1\n```')
    })

    it('formats code blocks without language', () => {
      const blocks: MessageBlock[] = [{ type: 'code', content: 'x = 1' }]
      const { content } = formatDiscordContent(blocks)

      expect(content).to.equal('```\nx = 1\n```')
    })

    it('formats link blocks as markdown links', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com', label: 'Example' },
      ]
      const { content } = formatDiscordContent(blocks)

      expect(content).to.equal('[Example](https://example.com)')
    })

    it('formats link blocks without label as raw URL', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com' },
      ]
      const { content } = formatDiscordContent(blocks)

      expect(content).to.equal('https://example.com')
    })

    it('formats divider blocks as markdown HR', () => {
      const blocks: MessageBlock[] = [{ type: 'divider' }]
      const { content } = formatDiscordContent(blocks)

      expect(content).to.equal('---')
    })

    it('formats status card blocks as embeds', () => {
      const blocks: MessageBlock[] = [{
        type: 'status_card',
        title: 'Build',
        status: 'failure',
        fields: [{ label: 'Error', value: 'Test failed' }],
      }]
      const { embeds } = formatDiscordContent(blocks)

      expect(embeds).to.have.length(1)
      const embed = embeds[0] as Record<string, unknown>
      expect(embed.title).to.include('[FAIL]')
      expect(embed.title).to.include('Build')
      expect(embed.color).to.equal(0xef4444) // red
    })

    it('uses correct colors for all status values', () => {
      const statuses = ['success', 'failure', 'warning', 'info', 'in_progress'] as const
      const expectedColors = [0x22c55e, 0xef4444, 0xf59e0b, 0x3b82f6, 0x8b5cf6]

      for (let i = 0; i < statuses.length; i++) {
        const blocks: MessageBlock[] = [{
          type: 'status_card',
          title: 'Test',
          status: statuses[i],
          fields: [],
        }]
        const { embeds } = formatDiscordContent(blocks)
        const embed = embeds[0] as Record<string, unknown>
        expect(embed.color).to.equal(expectedColors[i])
      }
    })
  })

  // ===========================================================================
  // formatWhatsAppText()
  // ===========================================================================

  describe('formatWhatsAppText()', () => {
    it('formats text blocks as plain text', () => {
      const blocks: MessageBlock[] = [{ type: 'text', content: 'Hello' }]
      expect(formatWhatsAppText(blocks)).to.equal('Hello')
    })

    it('formats code blocks with triple backticks', () => {
      const blocks: MessageBlock[] = [{ type: 'code', content: 'x = 1' }]
      expect(formatWhatsAppText(blocks)).to.equal('```x = 1```')
    })

    it('formats link blocks with label', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com', label: 'Example' },
      ]
      expect(formatWhatsAppText(blocks)).to.equal('Example: https://example.com')
    })

    it('formats link blocks without label as raw URL', () => {
      const blocks: MessageBlock[] = [
        { type: 'link', url: 'https://example.com' },
      ]
      expect(formatWhatsAppText(blocks)).to.equal('https://example.com')
    })

    it('formats status card blocks', () => {
      const blocks: MessageBlock[] = [{
        type: 'status_card',
        title: 'Build',
        status: 'warning',
        fields: [{ label: 'Warnings', value: '3' }],
      }]
      const result = formatWhatsAppText(blocks)
      expect(result).to.include('[WARN]')
      expect(result).to.include('*Build*')
      expect(result).to.include('Warnings: 3')
    })

    it('separates blocks with double newlines', () => {
      const blocks: MessageBlock[] = [
        { type: 'text', content: 'First' },
        { type: 'text', content: 'Second' },
      ]
      expect(formatWhatsAppText(blocks)).to.equal('First\n\nSecond')
    })
  })

  // ===========================================================================
  // formatOutboundMessage()
  // ===========================================================================

  describe('formatOutboundMessage()', () => {
    it('returns plain text when no blocks', () => {
      const msg: OutboundMessage = {
        platform: 'slack',
        channelId: 'C1',
        text: 'Plain text',
      }

      const result = formatOutboundMessage(msg)
      expect(result.text).to.equal('Plain text')
      expect(result.platformPayload).to.be.null
    })

    it('returns plain text when blocks is empty', () => {
      const msg: OutboundMessage = {
        platform: 'slack',
        channelId: 'C1',
        text: 'Plain text',
        blocks: [],
      }

      const result = formatOutboundMessage(msg)
      expect(result.text).to.equal('Plain text')
      expect(result.platformPayload).to.be.null
    })

    it('formats Slack messages with Block Kit', () => {
      const msg: OutboundMessage = {
        platform: 'slack',
        channelId: 'C1',
        text: 'Fallback',
        blocks: [{ type: 'text', content: 'Hello' }],
      }

      const result = formatOutboundMessage(msg)
      expect(result.text).to.equal('Fallback')
      expect(result.platformPayload).to.have.property('blocks')
    })

    it('formats Discord messages with embeds', () => {
      const msg: OutboundMessage = {
        platform: 'discord',
        channelId: 'ch-1',
        text: 'Fallback',
        blocks: [{
          type: 'status_card',
          title: 'Build',
          status: 'success',
          fields: [],
        }],
      }

      const result = formatOutboundMessage(msg)
      expect(result.platformPayload).to.have.property('embeds')
    })

    it('formats WhatsApp messages as plain text', () => {
      const msg: OutboundMessage = {
        platform: 'whatsapp',
        channelId: '+1234',
        text: 'Fallback',
        blocks: [{ type: 'text', content: 'Hello from WhatsApp' }],
      }

      const result = formatOutboundMessage(msg)
      expect(result.text).to.equal('Hello from WhatsApp')
      expect(result.platformPayload).to.be.null
    })
  })

  // ===========================================================================
  // parseMessageTarget()
  // ===========================================================================

  describe('parseMessageTarget()', () => {
    it('parses @agent-name prefix as direct message', () => {
      const result = parseMessageTarget('@my-agent do something')

      expect(result.mode).to.equal('direct')
      expect(result.agentId).to.equal('my-agent')
      expect(result.cleanText).to.equal('do something')
    })

    it('parses #TICKET-ID prefix as ticket-routed message', () => {
      const result = parseMessageTarget('#PRLT-123 check status')

      expect(result.mode).to.equal('direct')
      expect(result.ticketId).to.equal('PRLT-123')
      expect(result.cleanText).to.equal('check status')
    })

    it('defaults to broadcast for unprefixed messages', () => {
      const result = parseMessageTarget('hello everyone')

      expect(result.mode).to.equal('broadcast')
      expect(result.agentId).to.be.undefined
      expect(result.ticketId).to.be.undefined
      expect(result.cleanText).to.equal('hello everyone')
    })

    it('trims whitespace from clean text', () => {
      const result = parseMessageTarget('  hello  ')
      expect(result.cleanText).to.equal('hello')
    })

    it('handles agent names with hyphens and underscores', () => {
      const result = parseMessageTarget('@my_agent-123 test')
      expect(result.mode).to.equal('direct')
      expect(result.agentId).to.equal('my_agent-123')
    })

    it('handles multi-line messages', () => {
      const result = parseMessageTarget('@agent-1 line one\nline two\nline three')
      expect(result.mode).to.equal('direct')
      expect(result.agentId).to.equal('agent-1')
      expect(result.cleanText).to.include('line one')
      expect(result.cleanText).to.include('line two')
    })

    it('treats @ in middle of message as broadcast', () => {
      const result = parseMessageTarget('send to @agent-1 please')
      expect(result.mode).to.equal('broadcast')
    })
  })
})
