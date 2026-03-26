import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { detectStaleExecutions } from '../../src/lib/session/heartbeat.js'
import { SessionWatcher, type WatchCycleResult } from '../../src/lib/session/watcher.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'
import { detectState } from '../../src/commands/session/health.js'

const T = PMO_TABLES

/**
 * Unit tests for the heartbeat + timeout detection system (PRLT-1142)
 *
 * Tests cover:
 * - ExecutionStorage heartbeat methods (updateHeartbeat, getStaleExecutions, markHeartbeatTimeout)
 * - Stale execution detection logic
 * - Health state detection from tmux pane content
 * - SessionWatcher single-cycle behavior
 */
describe('@smoke Heartbeat + Timeout Detection', () => {
  let fastDb: FastTestDb
  let db: Database.Database
  let storage: ExecutionStorage

  before(() => {
    fastDb = createFastTestDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${T.agent_work} (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          executor TEXT NOT NULL,
          environment TEXT DEFAULT 'host',
          display_mode TEXT DEFAULT 'terminal',
          permission_mode TEXT DEFAULT 'safe',
          cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
          status TEXT NOT NULL,
          branch TEXT,
          pid TEXT,
          container_id TEXT,
          session_id TEXT,
          host TEXT,
          log_path TEXT,
          external_source TEXT,
          external_key TEXT,
          external_id TEXT,
          external_url TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          exit_code INTEGER,
          error_message TEXT,
          last_heartbeat TEXT,
          lifecycle_state TEXT DEFAULT 'healthy' CHECK (lifecycle_state IN ('healthy', 'idle', 'died', 'completed')),
          retries INTEGER NOT NULL DEFAULT 0
        )
      `)
    })
    db = fastDb.db
  })

  beforeEach(() => {
    fastDb.savepoint()
    storage = new ExecutionStorage(db)
  })

  afterEach(() => {
    fastDb.rollback()
  })

  after(() => {
    fastDb.close()
  })

  // ===========================================================================
  // ExecutionStorage: updateHeartbeat
  // ===========================================================================

  describe('updateHeartbeat', () => {
    it('writes current timestamp to last_heartbeat', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-HB1',
        agentName: 'heartbeat-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      // No heartbeat initially
      const before = storage.getExecution(exec.id)
      expect(before?.lastHeartbeat).to.be.undefined

      // Record heartbeat
      storage.updateHeartbeat(exec.id)

      // Heartbeat should now be set
      const after = storage.getExecution(exec.id)
      expect(after?.lastHeartbeat).to.not.be.undefined
      expect(after!.lastHeartbeat).to.be.instanceOf(Date)

      // Verify it's recent (within last 5 seconds)
      const ageMs = Date.now() - after!.lastHeartbeat!.getTime()
      expect(ageMs).to.be.lessThan(5000)
    })

    it('updates heartbeat on subsequent calls', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-HB2',
        agentName: 'heartbeat-agent-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateHeartbeat(exec.id)
      const first = storage.getExecution(exec.id)
      const firstHeartbeat = first!.lastHeartbeat!.toISOString()

      // Wait a tiny bit to ensure time difference
      const now = new Date(Date.now() + 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(now, exec.id)

      const second = storage.getExecution(exec.id)
      expect(second!.lastHeartbeat!.toISOString()).to.not.equal(firstHeartbeat)
    })
  })

  // ===========================================================================
  // ExecutionStorage: updateLifecycleState
  // ===========================================================================

  describe('updateLifecycleState', () => {
    it('sets lifecycle_state to healthy', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-LS1',
        agentName: 'lifecycle-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateLifecycleState(exec.id, 'healthy')
      const updated = storage.getExecution(exec.id)
      expect(updated?.lifecycleState).to.equal('healthy')
    })

    it('sets lifecycle_state to idle', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-LS2',
        agentName: 'lifecycle-agent-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateLifecycleState(exec.id, 'idle')
      const updated = storage.getExecution(exec.id)
      expect(updated?.lifecycleState).to.equal('idle')
    })

    it('sets lifecycle_state to died', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-LS3',
        agentName: 'lifecycle-agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateLifecycleState(exec.id, 'died')
      const updated = storage.getExecution(exec.id)
      expect(updated?.lifecycleState).to.equal('died')
    })
  })

  // ===========================================================================
  // ExecutionStorage: getStaleExecutions
  // ===========================================================================

  describe('getStaleExecutions', () => {
    it('returns empty when no running executions', () => {
      const stale = storage.getStaleExecutions(15)
      expect(stale).to.deep.equal([])
    })

    it('returns empty when heartbeats are fresh', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-FRESH',
        agentName: 'fresh-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')
      storage.updateHeartbeat(exec.id) // Fresh heartbeat

      const stale = storage.getStaleExecutions(15)
      expect(stale).to.have.length(0)
    })

    it('returns executions with old heartbeats', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-STALE',
        agentName: 'stale-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      // Set heartbeat to 20 minutes ago
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(oldTime, exec.id)

      const stale = storage.getStaleExecutions(15)
      expect(stale).to.have.length(1)
      expect(stale[0].id).to.equal(exec.id)
    })

    it('returns executions with no heartbeat if started long ago', () => {
      // Insert directly with old start time and no heartbeat
      const oldTime = Date.now() - 20 * 60 * 1000
      db.prepare(`
        INSERT INTO ${T.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, cleanup_policy, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-NO-HB',
        'TKT-NOHB',
        'no-heartbeat-agent',
        'claude-code',
        'host',
        'terminal',
        'safe',
        'on-exit',
        'running',
        oldTime,
      )

      const stale = storage.getStaleExecutions(15)
      expect(stale).to.have.length(1)
      expect(stale[0].id).to.equal('WORK-NO-HB')
    })

    it('excludes already-died executions', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-DIED',
        agentName: 'died-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')
      storage.updateLifecycleState(exec.id, 'died')

      // Set old heartbeat
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(oldTime, exec.id)

      const stale = storage.getStaleExecutions(15)
      expect(stale).to.have.length(0)
    })

    it('excludes completed executions', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-DONE',
        agentName: 'done-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'completed')

      const stale = storage.getStaleExecutions(15)
      expect(stale).to.have.length(0)
    })

    it('respects configurable timeout', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-TIMEOUT',
        agentName: 'timeout-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      // Set heartbeat to 10 minutes ago
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(tenMinAgo, exec.id)

      // With 15-minute timeout: not stale
      expect(storage.getStaleExecutions(15)).to.have.length(0)

      // With 5-minute timeout: stale
      expect(storage.getStaleExecutions(5)).to.have.length(1)
    })
  })

  // ===========================================================================
  // ExecutionStorage: markHeartbeatTimeout
  // ===========================================================================

  describe('markHeartbeatTimeout', () => {
    it('sets status to failed, lifecycle_state to died, and error message', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-MHT',
        agentName: 'timeout-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      storage.markHeartbeatTimeout(exec.id)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('failed')
      expect(updated?.lifecycleState).to.equal('died')
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.errorMessage).to.include('Heartbeat timeout')
    })
  })

  // ===========================================================================
  // ExecutionStorage: incrementRetries
  // ===========================================================================

  describe('incrementRetries', () => {
    it('increments from 0 to 1', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-RETRY',
        agentName: 'retry-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.incrementRetries(exec.id)

      const updated = storage.getExecution(exec.id)
      expect(updated?.retries).to.equal(1)
    })

    it('increments multiple times', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-RETRY2',
        agentName: 'retry-agent-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.incrementRetries(exec.id)
      storage.incrementRetries(exec.id)
      storage.incrementRetries(exec.id)

      const updated = storage.getExecution(exec.id)
      expect(updated?.retries).to.equal(3)
    })
  })

  // ===========================================================================
  // detectStaleExecutions (heartbeat.ts)
  // ===========================================================================

  describe('detectStaleExecutions', () => {
    it('returns stale info with duration and reason', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-DSE',
        agentName: 'detect-stale-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      // Set heartbeat to 20 minutes ago
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(oldTime, exec.id)

      const stale = detectStaleExecutions(storage, 15)
      expect(stale).to.have.length(1)
      expect(stale[0].execution.id).to.equal(exec.id)
      expect(stale[0].staleDurationMinutes).to.be.greaterThanOrEqual(19)
      expect(stale[0].reason).to.include('No heartbeat for')
    })

    it('returns reason for executions with no heartbeat since start', () => {
      // Insert directly with old start time
      const oldTime = Date.now() - 30 * 60 * 1000
      db.prepare(`
        INSERT INTO ${T.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, cleanup_policy, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-DSE2',
        'TKT-DSE2',
        'no-hb-detect-agent',
        'claude-code',
        'host',
        'terminal',
        'safe',
        'on-exit',
        'running',
        oldTime,
      )

      const stale = detectStaleExecutions(storage, 15)
      expect(stale).to.have.length(1)
      expect(stale[0].reason).to.include('No heartbeat since start')
    })
  })

  // ===========================================================================
  // detectState (health.ts) - Pane content detection
  // ===========================================================================

  describe('detectState', () => {
    it('returns HUNG for "0 tokens" pattern', () => {
      expect(detectState('↓ 0 tokens remaining\nSome other output')).to.equal('HUNG')
    })

    it('returns WORKING for "esc to interrupt" pattern', () => {
      expect(detectState('Processing files...\nesc to interrupt')).to.equal('WORKING')
    })

    it('returns DONE for "agent work complete" pattern', () => {
      expect(detectState('All done!\nagent work complete')).to.equal('DONE')
    })

    it('returns DONE for "work ready" pattern', () => {
      expect(detectState('Everything finished.\nwork ready')).to.equal('DONE')
    })

    it('returns IDLE for shell prompt pattern', () => {
      expect(detectState('Some output\n$ ')).to.equal('IDLE')
    })

    it('returns UNKNOWN for null content', () => {
      expect(detectState(null)).to.equal('UNKNOWN')
    })

    it('returns UNKNOWN for unrecognized content', () => {
      expect(detectState('Random text\nNothing recognizable')).to.equal('UNKNOWN')
    })
  })

  // ===========================================================================
  // SessionWatcher: runCycle (unit test — no tmux, no Docker)
  // ===========================================================================

  describe('SessionWatcher.runCycle', () => {
    it('handles empty database with no running executions', async () => {
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 5,
        timeoutMinutes: 15,
      })

      const result = await watcher.runCycle()
      expect(result.checked).to.equal(0)
      expect(result.heartbeatsUpdated).to.equal(0)
      expect(result.staleExecutions).to.have.length(0)
      expect(result.containersKilled).to.equal(0)
    })

    it('marks stale executions as failed', async () => {
      // Insert old running execution
      const oldTime = Date.now() - 20 * 60 * 1000
      db.prepare(`
        INSERT INTO ${T.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, cleanup_policy, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-STALE-W',
        'TKT-STALE-W',
        'stale-watcher-agent',
        'claude-code',
        'host',
        'terminal',
        'safe',
        'on-exit',
        'running',
        oldTime,
      )

      const logs: string[] = []
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 5,
        timeoutMinutes: 15,
        autoKill: false,
        log: (msg) => logs.push(msg),
      })

      const result = await watcher.runCycle()

      // Should detect the stale execution
      expect(result.staleExecutions).to.have.length(1)
      expect(result.staleExecutions[0].execution.id).to.equal('WORK-STALE-W')

      // Verify execution is now marked as failed
      const updated = storage.getExecution('WORK-STALE-W')
      expect(updated?.status).to.equal('failed')
      expect(updated?.lifecycleState).to.equal('died')
      expect(updated?.errorMessage).to.include('Heartbeat timeout')

      // Verify log output
      expect(logs.some(l => l.includes('Stale agent detected'))).to.be.true
    })

    it('calls onStaleDetected callback', async () => {
      const oldTime = Date.now() - 20 * 60 * 1000
      db.prepare(`
        INSERT INTO ${T.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, cleanup_policy, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-CALLBACK',
        'TKT-CALLBACK',
        'callback-agent',
        'claude-code',
        'host',
        'terminal',
        'safe',
        'on-exit',
        'running',
        oldTime,
      )

      const detected: Array<{ id: string; reason: string }> = []
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 5,
        timeoutMinutes: 15,
        autoKill: false,
        onStaleDetected: async (exec, reason) => {
          detected.push({ id: exec.id, reason })
        },
      })

      await watcher.runCycle()

      expect(detected).to.have.length(1)
      expect(detected[0].id).to.equal('WORK-CALLBACK')
      expect(detected[0].reason).to.include('heartbeat')
    })

    it('does not kill containers when autoKill is false', async () => {
      const oldTime = Date.now() - 20 * 60 * 1000
      db.prepare(`
        INSERT INTO ${T.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, cleanup_policy, status, started_at, container_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-NOKILL',
        'TKT-NOKILL',
        'no-kill-agent',
        'claude-code',
        'devcontainer',
        'terminal',
        'safe',
        'on-exit',
        'running',
        oldTime,
        'fake-container-123',
      )

      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 5,
        timeoutMinutes: 15,
        autoKill: false,
      })

      const result = await watcher.runCycle()
      expect(result.containersKilled).to.equal(0)
      expect(result.staleExecutions).to.have.length(1)
    })

    it('respects timeout configuration', async () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-CONFIG',
        agentName: 'config-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      // Set heartbeat to 10 minutes ago
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      db.prepare(`UPDATE ${T.agent_work} SET last_heartbeat = ? WHERE id = ?`)
        .run(tenMinAgo, exec.id)

      // With 15-min timeout: should not be stale
      const watcher15 = new SessionWatcher({
        db,
        timeoutMinutes: 15,
        autoKill: false,
      })
      const result15 = await watcher15.runCycle()
      expect(result15.staleExecutions).to.have.length(0)

      // With 5-min timeout: should be stale
      const watcher5 = new SessionWatcher({
        db,
        timeoutMinutes: 5,
        autoKill: false,
      })
      const result5 = await watcher5.runCycle()
      expect(result5.staleExecutions).to.have.length(1)
    })
  })

  // ===========================================================================
  // SessionWatcher: lifecycle
  // ===========================================================================

  describe('SessionWatcher lifecycle', () => {
    it('starts and stops cleanly', () => {
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 60, // Long interval so it doesn't fire during test
      })

      expect(watcher.isRunning()).to.be.false

      watcher.start()
      expect(watcher.isRunning()).to.be.true

      watcher.stop()
      expect(watcher.isRunning()).to.be.false
    })

    it('reports configuration', () => {
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 3,
        timeoutMinutes: 10,
        autoKill: false,
      })

      const config = watcher.getConfig()
      expect(config.intervalMinutes).to.equal(3)
      expect(config.timeoutMinutes).to.equal(10)
      expect(config.autoKill).to.be.false
    })

    it('start is idempotent', () => {
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 60,
      })

      watcher.start()
      watcher.start() // Should not error
      expect(watcher.isRunning()).to.be.true

      watcher.stop()
    })

    it('stop is idempotent', () => {
      const watcher = new SessionWatcher({
        db,
        intervalMinutes: 60,
      })

      watcher.stop() // Should not error when not running
      expect(watcher.isRunning()).to.be.false
    })
  })
})
