import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'

describe('MachineDB — orchestrator threads (PRLT-1265)', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-orch-threads-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('registerThread()', () => {
    it('registers a thread with all fields', () => {
      const thread = db.registerThread({
        name: 'main',
        address: 'host:tmux:prlt-orchestrator-hq-main',
      })
      expect(thread.name).to.equal('main')
      expect(thread.address).to.equal('host:tmux:prlt-orchestrator-hq-main')
      expect(thread.routes).to.be.null
      expect(thread.status).to.equal('active')
      expect(thread.registeredAt).to.be.instanceOf(Date)
      expect(thread.lastSeen).to.be.instanceOf(Date)
    })

    it('registers a thread with explicit routes', () => {
      const thread = db.registerThread({
        name: 'reviewer',
        address: 'host:tmux:prlt-orchestrator-hq-reviewer',
        routes: ['on_pr_opened', 'on_review_requested'],
      })
      expect(thread.routes).to.deep.equal(['on_pr_opened', 'on_review_requested'])
    })

    it('upserts on name conflict', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:old-session', routes: ['on_ci_failed'] })
      const updated = db.registerThread({ name: 'main', address: 'host:tmux:new-session', routes: ['on_pr_opened'] })
      expect(updated.address).to.equal('host:tmux:new-session')
      expect(updated.routes).to.deep.equal(['on_pr_opened'])
    })
  })

  describe('getThread()', () => {
    it('returns null for non-existent thread', () => {
      expect(db.getThread('nonexistent')).to.be.null
    })

    it('returns the registered thread', () => {
      db.registerThread({ name: 'ops', address: 'host:tmux:ops-session' })
      const thread = db.getThread('ops')
      expect(thread).to.not.be.null
      expect(thread!.name).to.equal('ops')
    })
  })

  describe('listThreads()', () => {
    it('returns empty array when no threads registered', () => {
      expect(db.listThreads()).to.have.lengthOf(0)
    })

    it('returns all threads', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.registerThread({ name: 'ops', address: 'host:tmux:ops' })
      expect(db.listThreads()).to.have.lengthOf(2)
    })

    it('filters by status', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.registerThread({ name: 'ops', address: 'host:tmux:ops' })
      db.updateThreadStatus('ops', 'inactive')
      expect(db.listThreads({ status: 'active' })).to.have.lengthOf(1)
      expect(db.listThreads({ status: 'inactive' })).to.have.lengthOf(1)
    })
  })

  describe('updateThreadStatus()', () => {
    it('marks a thread inactive', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.updateThreadStatus('main', 'inactive')
      expect(db.getThread('main')!.status).to.equal('inactive')
    })
  })

  describe('removeThread()', () => {
    it('deletes a registered thread', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.removeThread('main')
      expect(db.getThread('main')).to.be.null
    })
  })

  describe('findThreadForEvent()', () => {
    it('returns null when no threads are registered', () => {
      expect(db.findThreadForEvent('on_ci_failed')).to.be.null
    })

    it('returns catch-all thread when no specific route matches', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      const match = db.findThreadForEvent('on_ci_failed')
      expect(match).to.not.be.null
      expect(match!.name).to.equal('main')
    })

    it('returns specific thread over catch-all', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.registerThread({ name: 'reviewer', address: 'host:tmux:reviewer', routes: ['on_pr_opened', 'on_review_requested'] })
      expect(db.findThreadForEvent('on_pr_opened')!.name).to.equal('reviewer')
      expect(db.findThreadForEvent('on_ci_failed')!.name).to.equal('main')
    })

    it('skips inactive threads', () => {
      db.registerThread({ name: 'main', address: 'host:tmux:main' })
      db.updateThreadStatus('main', 'inactive')
      expect(db.findThreadForEvent('on_ci_failed')).to.be.null
    })
  })
})

describe('MachineDB — pending LLM decisions (PRLT-1265)', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-llm-decisions-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('createPendingLlmDecision()', () => {
    it('creates a decision with LLMD- prefix ID', () => {
      const decision = db.createPendingLlmDecision({ eventName: 'on_pr_opened', hookName: 'auto-merge', action: 'merge_pr' })
      expect(decision.id).to.match(/^LLMD-[A-Z0-9]{8}$/)
      expect(decision.status).to.equal('pending')
      expect(decision.eventName).to.equal('on_pr_opened')
      expect(decision.timeoutMs).to.equal(300000)
    })

    it('stores orchestrator name and context JSON', () => {
      const ctx = { ticketId: 'PRLT-100', prNumber: 42 }
      const decision = db.createPendingLlmDecision({
        eventName: 'on_ci_green', hookName: 'ship-it', action: 'merge',
        contextJson: JSON.stringify(ctx), orchestratorName: 'main', timeoutMs: 60000,
      })
      expect(decision.orchestratorName).to.equal('main')
      expect(JSON.parse(decision.contextJson)).to.deep.equal(ctx)
      expect(decision.timeoutMs).to.equal(60000)
    })
  })

  describe('listPendingLlmDecisions()', () => {
    it('returns empty array when none exist', () => {
      expect(db.listPendingLlmDecisions()).to.have.lengthOf(0)
    })

    it('filters by status', () => {
      const d = db.createPendingLlmDecision({ eventName: 'e1', hookName: 'h1', action: 'a1' })
      db.createPendingLlmDecision({ eventName: 'e2', hookName: 'h2', action: 'a2' })
      db.resolveLlmDecision(d.id, 'approved')
      expect(db.listPendingLlmDecisions({ status: 'pending' })).to.have.lengthOf(1)
      expect(db.listPendingLlmDecisions({ status: 'approved' })).to.have.lengthOf(1)
    })
  })

  describe('resolveLlmDecision()', () => {
    it('marks decision as approved with resolvedAt', () => {
      const d = db.createPendingLlmDecision({ eventName: 'e', hookName: 'h', action: 'a' })
      db.resolveLlmDecision(d.id, 'approved')
      const resolved = db.getPendingLlmDecision(d.id)
      expect(resolved!.status).to.equal('approved')
      expect(resolved!.decision).to.equal('approved')
      expect(resolved!.resolvedAt).to.not.be.null
    })
  })

  describe('escalateTimedOutDecisions()', () => {
    it('escalates decisions past their timeout', () => {
      // Create a decision with a normal timeout, then backdate queued_at
      // so it appears to have expired (avoids same-ms race condition)
      const d = db.createPendingLlmDecision({ eventName: 'e', hookName: 'h', action: 'a', timeoutMs: 1000 })
      // Backdate by 2 seconds so it's past the 1-second timeout
      const backdated = Date.now() - 2000
      ;(db as any).db.prepare('UPDATE pending_llm_decisions SET queued_at = ? WHERE id = ?').run(backdated, d.id)
      const count = db.escalateTimedOutDecisions()
      expect(count).to.equal(1)
      expect(db.listPendingLlmDecisions({ status: 'timed_out' })).to.have.lengthOf(1)
    })

    it('does not escalate decisions within timeout', () => {
      db.createPendingLlmDecision({ eventName: 'e', hookName: 'h', action: 'a', timeoutMs: 300000 })
      expect(db.escalateTimedOutDecisions()).to.equal(0)
    })
  })
})
