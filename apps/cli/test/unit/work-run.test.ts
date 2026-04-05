import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'
import { generateAgentName } from '../../src/lib/agent-naming.js'

/**
 * PRLT-1245: Ticketless work mode tests.
 *
 * Tests the core pieces used by `prlt work run`:
 * 1. MachineDB execution tracking (create, update, query)
 * 2. Agent name generation (no HQ/theme needed)
 * 3. Ticketless execution lifecycle (start → running → complete)
 * 4. Cross-repo execution visibility
 */

describe('PRLT-1245: Ticketless work mode', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-work-run-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // Agent naming without HQ
  // ===========================================================================

  describe('agent naming without workspace', () => {
    it('generates adjective-noun agent names', () => {
      const name = generateAgentName()
      expect(name).to.match(/^[a-z]+-[a-z]+$/)
    })

    it('generates different names on successive calls', () => {
      // Run enough times to be confident they're not always the same
      const names = new Set<string>()
      for (let i = 0; i < 20; i++) {
        names.add(generateAgentName())
      }
      // With 24 adjectives x 24 nouns = 576 combos, 20 calls should produce > 1 unique
      expect(names.size).to.be.greaterThan(1)
    })
  })

  // ===========================================================================
  // Ticketless execution lifecycle
  // ===========================================================================

  describe('ticketless execution lifecycle', () => {
    it('creates a ticketless execution without ticket ID', () => {
      const exec = db.createExecution({
        prompt: 'refactor auth module',
        repoPath: '/home/user/projects/myapp',
        agentName: 'bold-fox',
      })

      expect(exec.ticketId).to.be.undefined
      expect(exec.prompt).to.equal('refactor auth module')
      expect(exec.status).to.equal('starting')
    })

    it('transitions through full lifecycle: starting → running → completed', () => {
      const exec = db.createExecution({
        prompt: 'add tests',
        repoPath: '/repo',
        agentName: 'calm-ray',
      })
      expect(exec.status).to.equal('starting')

      db.updateStatus(exec.id, 'running')
      const running = db.getExecution(exec.id)!
      expect(running.status).to.equal('running')
      expect(running.completedAt).to.be.undefined

      db.updateStatus(exec.id, 'completed', 0)
      const completed = db.getExecution(exec.id)!
      expect(completed.status).to.equal('completed')
      expect(completed.completedAt).to.be.instanceOf(Date)
      expect(completed.exitCode).to.equal(0)
    })

    it('handles failed execution with error message', () => {
      const exec = db.createExecution({
        prompt: 'fix bug',
        repoPath: '/repo',
        agentName: 'agent',
      })

      db.updateStatus(exec.id, 'running')
      db.updateStatus(exec.id, 'failed', 1, 'compilation error')

      const failed = db.getExecution(exec.id)!
      expect(failed.status).to.equal('failed')
      expect(failed.exitCode).to.equal(1)
      expect(failed.errorMessage).to.equal('compilation error')
    })

    it('tracks process info after launch', () => {
      const exec = db.createExecution({
        prompt: 'work',
        repoPath: '/repo',
        agentName: 'agent',
        environment: 'docker',
      })

      db.updateProcessInfo(exec.id, {
        containerId: 'abc123def',
        sessionId: 'MRUN-test-run-agent',
        branch: 'feat/new-feature',
      })

      const updated = db.getExecution(exec.id)!
      expect(updated.containerId).to.equal('abc123def')
      expect(updated.sessionId).to.equal('MRUN-test-run-agent')
      expect(updated.branch).to.equal('feat/new-feature')
    })
  })

  // ===========================================================================
  // Cross-repo execution visibility
  // ===========================================================================

  describe('cross-repo execution visibility', () => {
    it('tracks executions across multiple repos', () => {
      db.createExecution({
        prompt: 'task in repo A',
        repoPath: '/projects/repo-a',
        agentName: 'agent-a',
      })
      db.createExecution({
        prompt: 'task in repo B',
        repoPath: '/projects/repo-b',
        agentName: 'agent-b',
      })
      db.createExecution({
        prompt: 'task in repo C',
        repoPath: '/projects/repo-c',
        agentName: 'agent-c',
      })

      const all = db.listExecutions()
      expect(all).to.have.lengthOf(3)
      const repos = all.map(e => e.repoPath)
      expect(repos).to.include('/projects/repo-a')
      expect(repos).to.include('/projects/repo-b')
      expect(repos).to.include('/projects/repo-c')
    })

    it('getActiveExecutions returns only active across all repos', () => {
      const e1 = db.createExecution({
        prompt: 'task 1',
        repoPath: '/repo-a',
        agentName: 'a',
      })
      db.updateStatus(e1.id, 'running')

      db.createExecution({
        prompt: 'task 2',
        repoPath: '/repo-b',
        agentName: 'b',
      })

      const e3 = db.createExecution({
        prompt: 'task 3',
        repoPath: '/repo-c',
        agentName: 'c',
      })
      db.updateStatus(e3.id, 'completed')

      const active = db.getActiveExecutions()
      expect(active).to.have.lengthOf(2)
    })

    it('can filter executions by repo path', () => {
      db.createExecution({ prompt: 'a', repoPath: '/repo-x', agentName: 'x' })
      db.createExecution({ prompt: 'b', repoPath: '/repo-y', agentName: 'y' })

      const filtered = db.listExecutions({ repoPath: '/repo-x' })
      expect(filtered).to.have.lengthOf(1)
      expect(filtered[0].repoPath).to.equal('/repo-x')
    })
  })

  // ===========================================================================
  // Ticketed + ticketless coexistence
  // ===========================================================================

  describe('ticketed and ticketless coexistence', () => {
    it('can store both ticketed and ticketless executions', () => {
      db.createExecution({
        prompt: 'implement feature',
        repoPath: '/repo',
        agentName: 'agent-1',
        ticketId: 'PRLT-123',
      })
      db.createExecution({
        prompt: 'refactor auth',
        repoPath: '/repo',
        agentName: 'agent-2',
        // No ticketId — ticketless
      })

      const all = db.listExecutions()
      expect(all).to.have.lengthOf(2)

      const ticketed = all.find(e => e.ticketId === 'PRLT-123')
      const ticketless = all.find(e => !e.ticketId)
      expect(ticketed).to.not.be.undefined
      expect(ticketless).to.not.be.undefined
    })
  })

  // ===========================================================================
  // --create-pr flag
  // ===========================================================================

  describe('--create-pr flag', () => {
    it('stores create-pr preference in execution record', () => {
      const withPr = db.createExecution({
        prompt: 'add feature',
        repoPath: '/repo',
        agentName: 'agent',
        createPr: true,
      })
      expect(withPr.createPr).to.be.true

      const withoutPr = db.createExecution({
        prompt: 'refactor',
        repoPath: '/repo',
        agentName: 'agent2',
        createPr: false,
      })
      expect(withoutPr.createPr).to.be.false
    })
  })

  // ===========================================================================
  // Health tracking integration
  // ===========================================================================

  describe('execution health tracking', () => {
    it('tracks heartbeats for ticketless executions', () => {
      const exec = db.createExecution({
        prompt: 'long-running task',
        repoPath: '/repo',
        agentName: 'agent',
      })
      db.updateStatus(exec.id, 'running')
      db.updateHeartbeat(exec.id)

      const health = db.getHealth(exec.id)
      expect(health).to.not.be.null
      expect(health!.lifecycleState).to.equal('healthy')
    })

    it('detects stale ticketless executions', async () => {
      const exec = db.createExecution({
        prompt: 'stuck task',
        repoPath: '/repo',
        agentName: 'agent',
      })
      db.updateStatus(exec.id, 'running')

      // Wait a tick so started_at is strictly in the past
      await new Promise<void>(resolve => setTimeout(resolve, 2))

      // With 0-minute timeout (cutoff = now), the execution started before now
      const stale = db.getStaleExecutions(0)
      expect(stale).to.have.lengthOf(1)
      expect(stale[0].id).to.equal(exec.id)
    })
  })
})
