import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB, type MachineExecution, type MachineExecutionStatus } from '../../src/lib/machine-db.js'

// Ensure Date.now() advances between rapid creates to avoid ordering ties
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 2))

describe('MachineDB', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-machine-db-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // Schema
  // ===========================================================================

  describe('schema', () => {
    it('creates database and tables on construction', () => {
      expect(fs.existsSync(dbPath)).to.be.true
      // Verify we can create an execution (tables exist)
      const exec = db.createExecution({
        prompt: 'test',
        repoPath: '/repo',
        agentName: 'agent-1',
      })
      expect(exec.id).to.match(/^MRUN-/)
    })

    it('is idempotent — can reopen same database', () => {
      db.createExecution({
        prompt: 'test',
        repoPath: '/repo',
        agentName: 'agent-1',
      })
      db.close()

      // Reopen same DB
      const db2 = new MachineDB(dbPath)
      const execs = db2.listExecutions()
      expect(execs).to.have.lengthOf(1)
      db2.close()

      // Re-assign for afterEach cleanup
      db = new MachineDB(dbPath)
    })
  })

  // ===========================================================================
  // createExecution()
  // ===========================================================================

  describe('createExecution()', () => {
    it('creates an execution with required fields', () => {
      const exec = db.createExecution({
        prompt: 'refactor auth module',
        repoPath: '/home/user/projects/myapp',
        agentName: 'bold-fox',
      })

      expect(exec.id).to.match(/^MRUN-[A-Z0-9]{8}$/)
      expect(exec.prompt).to.equal('refactor auth module')
      expect(exec.repoPath).to.equal('/home/user/projects/myapp')
      expect(exec.agentName).to.equal('bold-fox')
      expect(exec.executor).to.equal('claude-code')
      expect(exec.environment).to.equal('host')
      expect(exec.status).to.equal('starting')
      expect(exec.ticketId).to.be.undefined
      expect(exec.createPr).to.be.false
      expect(exec.startedAt).to.be.instanceOf(Date)
      expect(exec.completedAt).to.be.undefined
      expect(exec.containerId).to.be.undefined
      expect(exec.sessionId).to.be.undefined
    })

    it('creates an execution with all optional fields', () => {
      const exec = db.createExecution({
        prompt: 'fix auth bug',
        repoPath: '/repo',
        agentName: 'calm-ray',
        executor: 'codex',
        environment: 'docker',
        branch: 'fix/auth-bug',
        ticketId: 'PRLT-123',
        createPr: true,
      })

      expect(exec.executor).to.equal('codex')
      expect(exec.environment).to.equal('docker')
      expect(exec.branch).to.equal('fix/auth-bug')
      expect(exec.ticketId).to.equal('PRLT-123')
      expect(exec.createPr).to.be.true
    })

    it('generates unique IDs', () => {
      const e1 = db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'a' })
      const e2 = db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'b' })
      expect(e1.id).to.not.equal(e2.id)
    })
  })

  // ===========================================================================
  // getExecution()
  // ===========================================================================

  describe('getExecution()', () => {
    it('retrieves an execution by ID', () => {
      const created = db.createExecution({
        prompt: 'test',
        repoPath: '/repo',
        agentName: 'agent',
      })

      const found = db.getExecution(created.id)
      expect(found).to.not.be.null
      expect(found!.id).to.equal(created.id)
      expect(found!.prompt).to.equal('test')
    })

    it('returns null for non-existent ID', () => {
      const found = db.getExecution('MRUN-NONEXIST')
      expect(found).to.be.null
    })
  })

  // ===========================================================================
  // listExecutions()
  // ===========================================================================

  describe('listExecutions()', () => {
    it('lists all executions when no filter provided', () => {
      db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'a' })
      db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'b' })

      const all = db.listExecutions()
      expect(all).to.have.lengthOf(2)
    })

    it('filters by status', () => {
      const e1 = db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'a' })
      db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'b' })
      db.updateStatus(e1.id, 'completed')

      const completed = db.listExecutions({ status: 'completed' })
      expect(completed).to.have.lengthOf(1)
      expect(completed[0].id).to.equal(e1.id)

      const starting = db.listExecutions({ status: 'starting' })
      expect(starting).to.have.lengthOf(1)
    })

    it('filters by repoPath', () => {
      db.createExecution({ prompt: 'task 1', repoPath: '/repo-a', agentName: 'a' })
      db.createExecution({ prompt: 'task 2', repoPath: '/repo-b', agentName: 'b' })

      const filtered = db.listExecutions({ repoPath: '/repo-a' })
      expect(filtered).to.have.lengthOf(1)
      expect(filtered[0].repoPath).to.equal('/repo-a')
    })

    it('filters by agentName', () => {
      db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'alice' })
      db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'bob' })

      const filtered = db.listExecutions({ agentName: 'alice' })
      expect(filtered).to.have.lengthOf(1)
      expect(filtered[0].agentName).to.equal('alice')
    })

    it('respects limit', () => {
      db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'a' })
      db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'b' })
      db.createExecution({ prompt: 'task 3', repoPath: '/r', agentName: 'c' })

      const limited = db.listExecutions({ limit: 2 })
      expect(limited).to.have.lengthOf(2)
    })

    it('returns empty array when no executions exist', () => {
      const all = db.listExecutions()
      expect(all).to.deep.equal([])
    })

    it('returns executions in descending order by startedAt', async () => {
      db.createExecution({ prompt: 'first', repoPath: '/r', agentName: 'a' })
      await tick()
      db.createExecution({ prompt: 'second', repoPath: '/r', agentName: 'b' })

      const all = db.listExecutions()
      expect(all[0].prompt).to.equal('second')
      expect(all[1].prompt).to.equal('first')
    })
  })

  // ===========================================================================
  // updateStatus()
  // ===========================================================================

  describe('updateStatus()', () => {
    it('updates status to running', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'running')

      const updated = db.getExecution(exec.id)!
      expect(updated.status).to.equal('running')
      expect(updated.completedAt).to.be.undefined
    })

    it('updates status to completed and sets completedAt', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'completed')

      const updated = db.getExecution(exec.id)!
      expect(updated.status).to.equal('completed')
      expect(updated.completedAt).to.be.instanceOf(Date)
    })

    it('updates status to failed with exit code and error', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'failed', 1, 'segfault')

      const updated = db.getExecution(exec.id)!
      expect(updated.status).to.equal('failed')
      expect(updated.exitCode).to.equal(1)
      expect(updated.errorMessage).to.equal('segfault')
      expect(updated.completedAt).to.be.instanceOf(Date)
    })

    it('updates status to stopped and sets completedAt', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'stopped')

      const updated = db.getExecution(exec.id)!
      expect(updated.status).to.equal('stopped')
      expect(updated.completedAt).to.be.instanceOf(Date)
    })
  })

  // ===========================================================================
  // updateProcessInfo()
  // ===========================================================================

  describe('updateProcessInfo()', () => {
    it('updates containerId and sessionId', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateProcessInfo(exec.id, {
        containerId: 'abc123def456',
        sessionId: 'MRUN-123-run-agent',
      })

      const updated = db.getExecution(exec.id)!
      expect(updated.containerId).to.equal('abc123def456')
      expect(updated.sessionId).to.equal('MRUN-123-run-agent')
    })

    it('updates branch', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateProcessInfo(exec.id, { branch: 'feat/new-thing' })

      const updated = db.getExecution(exec.id)!
      expect(updated.branch).to.equal('feat/new-thing')
    })

    it('does nothing when no fields provided', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateProcessInfo(exec.id, {})

      const updated = db.getExecution(exec.id)!
      expect(updated.containerId).to.be.undefined
    })
  })

  // ===========================================================================
  // getActiveExecutions()
  // ===========================================================================

  describe('getActiveExecutions()', () => {
    it('returns starting and running executions', () => {
      const e1 = db.createExecution({ prompt: 'task 1', repoPath: '/r', agentName: 'a' })
      const e2 = db.createExecution({ prompt: 'task 2', repoPath: '/r', agentName: 'b' })
      db.updateStatus(e2.id, 'running')
      const e3 = db.createExecution({ prompt: 'task 3', repoPath: '/r', agentName: 'c' })
      db.updateStatus(e3.id, 'completed')

      const active = db.getActiveExecutions()
      expect(active).to.have.lengthOf(2)
      const ids = active.map(e => e.id)
      expect(ids).to.include(e1.id)
      expect(ids).to.include(e2.id)
    })

    it('returns empty array when no active executions', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'completed')

      const active = db.getActiveExecutions()
      expect(active).to.deep.equal([])
    })
  })

  // ===========================================================================
  // deleteExecution()
  // ===========================================================================

  describe('deleteExecution()', () => {
    it('deletes an execution record', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.deleteExecution(exec.id)

      const found = db.getExecution(exec.id)
      expect(found).to.be.null
    })
  })

  // ===========================================================================
  // Agent Health
  // ===========================================================================

  describe('agent health', () => {
    it('creates and retrieves health record via updateHeartbeat', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateHeartbeat(exec.id)

      const health = db.getHealth(exec.id)
      expect(health).to.not.be.null
      expect(health!.executionId).to.equal(exec.id)
      expect(health!.lifecycleState).to.equal('healthy')
      expect(health!.retries).to.equal(0)
      expect(health!.lastHeartbeat).to.be.instanceOf(Date)
    })

    it('updates lifecycle state', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateHeartbeat(exec.id)
      db.updateLifecycleState(exec.id, 'died')

      const health = db.getHealth(exec.id)
      expect(health!.lifecycleState).to.equal('died')
    })

    it('increments retries', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateHeartbeat(exec.id)
      db.incrementRetries(exec.id)
      db.incrementRetries(exec.id)

      const health = db.getHealth(exec.id)
      expect(health!.retries).to.equal(2)
    })

    it('returns null health for execution without heartbeat', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      const health = db.getHealth(exec.id)
      expect(health).to.be.null
    })

    it('cascades delete from execution to health', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateHeartbeat(exec.id)
      db.deleteExecution(exec.id)

      const health = db.getHealth(exec.id)
      expect(health).to.be.null
    })
  })

  // ===========================================================================
  // Persistent Agents
  // ===========================================================================

  describe('persistent agents', () => {
    it('creates a persistent execution with cleanup_policy=persistent', () => {
      const exec = db.createExecution({
        prompt: 'you are the backend reviewer',
        repoPath: '/repo',
        agentName: 'reviewer',
        persistent: true,
      })

      expect(exec.persistent).to.be.true
      expect(exec.cleanupPolicy).to.equal('persistent')
    })

    it('defaults ephemeral executions to persistent=false, cleanup=on-exit', () => {
      const exec = db.createExecution({
        prompt: 'quick task',
        repoPath: '/repo',
        agentName: 'temp-agent',
      })

      expect(exec.persistent).to.be.false
      expect(exec.cleanupPolicy).to.equal('on-exit')
    })

    it('allows explicit cleanup policy override', () => {
      const exec = db.createExecution({
        prompt: 'task',
        repoPath: '/repo',
        agentName: 'agent',
        persistent: true,
        cleanupPolicy: 'on-error-keep',
      })

      expect(exec.persistent).to.be.true
      expect(exec.cleanupPolicy).to.equal('on-error-keep')
    })

    describe('getPersistentAgent()', () => {
      it('finds a persistent agent by name', () => {
        db.createExecution({
          prompt: 'backend reviewer',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })

        const found = db.getPersistentAgent('reviewer')
        expect(found).to.not.be.null
        expect(found!.agentName).to.equal('reviewer')
        expect(found!.persistent).to.be.true
      })

      it('returns null for non-persistent agents with same name', () => {
        db.createExecution({
          prompt: 'ephemeral task',
          repoPath: '/repo',
          agentName: 'worker',
          persistent: false,
        })

        const found = db.getPersistentAgent('worker')
        expect(found).to.be.null
      })

      it('returns most recent execution for persistent agent', async () => {
        db.createExecution({
          prompt: 'first run',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })
        await tick()
        const e2 = db.createExecution({
          prompt: 'second run (restarted)',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })

        const found = db.getPersistentAgent('reviewer')
        expect(found!.id).to.equal(e2.id)
        expect(found!.prompt).to.equal('second run (restarted)')
      })

      it('returns null for non-existent agent', () => {
        const found = db.getPersistentAgent('does-not-exist')
        expect(found).to.be.null
      })
    })

    describe('listPersistentAgents()', () => {
      it('lists all persistent agents', () => {
        db.createExecution({
          prompt: 'reviewer prompt',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })
        db.createExecution({
          prompt: 'watcher prompt',
          repoPath: '/repo',
          agentName: 'ci-watcher',
          persistent: true,
        })
        // Ephemeral — should NOT appear
        db.createExecution({
          prompt: 'quick fix',
          repoPath: '/repo',
          agentName: 'temp-worker',
          persistent: false,
        })

        const agents = db.listPersistentAgents()
        expect(agents).to.have.lengthOf(2)
        const names = agents.map(a => a.agentName)
        expect(names).to.include('reviewer')
        expect(names).to.include('ci-watcher')
      })

      it('returns empty array when no persistent agents exist', () => {
        db.createExecution({
          prompt: 'ephemeral task',
          repoPath: '/repo',
          agentName: 'temp',
        })

        const agents = db.listPersistentAgents()
        expect(agents).to.deep.equal([])
      })
    })

    describe('getDiedPersistentAgents()', () => {
      it('returns persistent agents that failed', () => {
        const exec = db.createExecution({
          prompt: 'reviewer',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })
        db.updateStatus(exec.id, 'running')
        db.updateStatus(exec.id, 'failed', 1, 'crashed')

        const died = db.getDiedPersistentAgents()
        expect(died).to.have.lengthOf(1)
        expect(died[0].agentName).to.equal('reviewer')
      })

      it('excludes running persistent agents', () => {
        const exec = db.createExecution({
          prompt: 'reviewer',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })
        db.updateStatus(exec.id, 'running')

        const died = db.getDiedPersistentAgents()
        expect(died).to.deep.equal([])
      })

      it('excludes ephemeral failed agents', () => {
        const exec = db.createExecution({
          prompt: 'temp task',
          repoPath: '/repo',
          agentName: 'temp',
          persistent: false,
        })
        db.updateStatus(exec.id, 'failed', 1)

        const died = db.getDiedPersistentAgents()
        expect(died).to.deep.equal([])
      })
    })

    describe('listExecutions persistent filter', () => {
      it('filters by persistent flag', () => {
        db.createExecution({
          prompt: 'persistent task',
          repoPath: '/repo',
          agentName: 'reviewer',
          persistent: true,
        })
        db.createExecution({
          prompt: 'ephemeral task',
          repoPath: '/repo',
          agentName: 'temp',
          persistent: false,
        })

        const persistentOnly = db.listExecutions({ persistent: true })
        expect(persistentOnly).to.have.lengthOf(1)
        expect(persistentOnly[0].agentName).to.equal('reviewer')

        const ephemeralOnly = db.listExecutions({ persistent: false })
        expect(ephemeralOnly).to.have.lengthOf(1)
        expect(ephemeralOnly[0].agentName).to.equal('temp')
      })
    })
  })

  // ===========================================================================
  // getStaleExecutions()
  // ===========================================================================

  describe('getStaleExecutions()', () => {
    it('returns executions with no heartbeat older than timeout', async () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'running')

      // Wait a tick so started_at is strictly in the past relative to the cutoff
      await tick()

      // With a 0-minute timeout (cutoff = now), the execution started before now
      const stale = db.getStaleExecutions(0)
      expect(stale).to.have.lengthOf(1)
      expect(stale[0].id).to.equal(exec.id)
    })

    it('excludes executions with recent heartbeat', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'running')
      db.updateHeartbeat(exec.id)

      // With a 60-minute timeout, recent heartbeat should not be stale
      const stale = db.getStaleExecutions(60)
      expect(stale).to.have.lengthOf(0)
    })

    it('excludes completed/failed/stopped executions', () => {
      const e1 = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(e1.id, 'completed')

      const stale = db.getStaleExecutions(0)
      expect(stale).to.have.lengthOf(0)
    })

    it('excludes executions with died lifecycle state', () => {
      const exec = db.createExecution({ prompt: 'test', repoPath: '/r', agentName: 'a' })
      db.updateStatus(exec.id, 'running')
      db.updateLifecycleState(exec.id, 'died')

      const stale = db.getStaleExecutions(0)
      expect(stale).to.have.lengthOf(0)
    })
  })
})
