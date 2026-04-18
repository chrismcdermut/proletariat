import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  formatDaemonMessage,
  parseDaemonMessage,
  parseThreadAddress,
  escalationToMessage,
  queueAndFormatDecision,
} from '../../src/lib/orchestrate/thread-router.js'
import { MachineDB } from '../../src/lib/machine-db.js'
import type { EscalationContext } from '../../src/lib/orchestrate/escalation.js'

describe('thread-router — message formatting (PRLT-1265)', () => {
  describe('formatDaemonMessage()', () => {
    it('formats a daemon message with ticket ID', () => {
      const result = formatDaemonMessage({
        type: 'daemon', eventName: 'on_pr_conflicting', ticketId: 'PRLT-1259',
        body: 'PR #1094 has conflicts on main.',
      })
      expect(result).to.equal('[daemon:on_pr_conflicting:PRLT-1259] PR #1094 has conflicts on main.')
    })

    it('formats a notify message without ticket ID', () => {
      const result = formatDaemonMessage({
        type: 'notify', eventName: 'on_ci_failed',
        body: 'CI failed on e2e-tests.',
      })
      expect(result).to.equal('[notify:on_ci_failed] CI failed on e2e-tests.')
    })
  })

  describe('parseDaemonMessage()', () => {
    it('parses a daemon message with ticket ID', () => {
      const parsed = parseDaemonMessage('[daemon:on_pr_conflicting:PRLT-1259] PR #1094 has conflicts.')
      expect(parsed).to.not.be.null
      expect(parsed!.type).to.equal('daemon')
      expect(parsed!.eventName).to.equal('on_pr_conflicting')
      expect(parsed!.ticketId).to.equal('PRLT-1259')
      expect(parsed!.body).to.equal('PR #1094 has conflicts.')
    })

    it('parses a notify message without ticket ID', () => {
      const parsed = parseDaemonMessage('[notify:on_ci_failed] CI failed.')
      expect(parsed!.type).to.equal('notify')
      expect(parsed!.eventName).to.equal('on_ci_failed')
      expect(parsed!.ticketId).to.be.undefined
    })

    it('returns null for plain human input', () => {
      expect(parseDaemonMessage('hey what is the status on PRLT-1259')).to.be.null
    })

    it('roundtrips through format and parse', () => {
      const original = {
        type: 'daemon' as const, eventName: 'on_review_approved',
        ticketId: 'TKT-100', body: 'Review approved by alice.',
      }
      const formatted = formatDaemonMessage(original)
      const parsed = parseDaemonMessage(formatted)
      expect(parsed).to.deep.equal(original)
    })
  })
})

describe('thread-router — address parsing (PRLT-1265)', () => {
  describe('parseThreadAddress()', () => {
    it('parses host tmux address', () => {
      const result = parseThreadAddress('host:tmux:prlt-orchestrator-hq-main')
      expect(result.environment).to.equal('host')
      expect(result.sessionId).to.equal('prlt-orchestrator-hq-main')
      expect(result.containerId).to.be.undefined
    })

    it('parses container tmux address', () => {
      const result = parseThreadAddress('container:abc123def/tmux:prlt-orchestrator-hq-reviewer')
      expect(result.environment).to.equal('container')
      expect(result.containerId).to.equal('abc123def')
      expect(result.sessionId).to.equal('prlt-orchestrator-hq-reviewer')
    })
  })
})

describe('thread-router — escalation formatting (PRLT-1265)', () => {
  it('builds a daemon message from escalation context', () => {
    const ctx: EscalationContext = {
      hookName: 'auto-merge', event: 'on_ci_green', action: 'merge_pr',
      ctx: { ticketId: 'PRLT-100', prNumber: 42 },
    }
    const msg = escalationToMessage(ctx, 'LLMD-ABC12345')
    expect(msg.type).to.equal('daemon')
    expect(msg.eventName).to.equal('on_ci_green')
    expect(msg.ticketId).to.equal('PRLT-100')
    expect(msg.body).to.include('auto-merge')
    expect(msg.body).to.include('LLMD-ABC12345')
  })
})

describe('thread-router — queueAndFormatDecision (PRLT-1265)', () => {
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-router-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    const db = new MachineDB(dbPath)
    db.registerThread({ name: 'main', address: 'host:tmux:prlt-orchestrator-hq-main' })
    db.registerThread({ name: 'reviewer', address: 'host:tmux:prlt-orchestrator-hq-reviewer', routes: ['on_pr_opened', 'on_review_requested'] })
    db.close()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('queues a decision and returns formatted message for matching event', () => {
    const ctx: EscalationContext = {
      hookName: 'review-check', event: 'on_pr_opened', action: 'auto_review',
      ctx: { ticketId: 'PRLT-200' },
    }
    const result = queueAndFormatDecision(ctx, dbPath)
    expect(result).to.not.be.null
    expect(result!.thread.name).to.equal('reviewer')
    expect(result!.decision.status).to.equal('pending')
    expect(result!.decision.id).to.match(/^LLMD-/)
    expect(result!.message).to.include('[daemon:on_pr_opened:PRLT-200]')
  })

  it('routes unmatched events to catch-all', () => {
    const ctx: EscalationContext = {
      hookName: 'ci-check', event: 'on_ci_failed', action: 'notify_team', ctx: {},
    }
    const result = queueAndFormatDecision(ctx, dbPath)
    expect(result!.thread.name).to.equal('main')
  })

  it('returns null when no thread handles the event', () => {
    const db = new MachineDB(dbPath)
    db.removeThread('main')
    db.removeThread('reviewer')
    db.close()

    const ctx: EscalationContext = {
      hookName: 'test', event: 'on_ci_failed', action: 'test', ctx: {},
    }
    expect(queueAndFormatDecision(ctx, dbPath)).to.be.null
  })
})
