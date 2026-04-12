/**
 * Unit tests for daemon role support (PRLT-1287)
 *
 * Tests:
 * 1. Session role is stored and retrieved correctly in ExecutionStorage
 * 2. cleanupStaleExecutions skips daemon-role sessions
 * 3. Daemon sessions show in session list with correct role
 * 4. Session prune does NOT reap daemon-role sessions
 * 5. Reconciler supervisor spawn/restart logic
 */

import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'
import { RECONCILER_SESSION_NAME, DAEMON_TICKET_ID, isReconcilerRunning } from '../../src/commands/reconcile.js'

describe('@smoke Daemon role support (PRLT-1287)', () => {
  let fastDb: FastTestDb
  let db: SqliteDatabase
  let storage: ExecutionStorage

  before(() => {
    fastDb = createFastTestDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${PMO_TABLES.agent_work} (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          executor TEXT NOT NULL,
          environment TEXT DEFAULT 'host',
          display_mode TEXT DEFAULT 'terminal',
          permission_mode TEXT DEFAULT 'safe',
          cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
          role TEXT NOT NULL DEFAULT 'worker',
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
          error_message TEXT
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

  // =========================================================================
  // 1. Session role is stored and retrieved correctly
  // =========================================================================

  describe('createExecution with role', () => {
    it('defaults to worker role when not specified', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
      })

      expect(exec.role).to.equal('worker')
    })

    it('stores daemon role correctly', () => {
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        cleanupPolicy: 'persistent',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })

      expect(exec.role).to.equal('daemon')
      expect(exec.ticketId).to.equal('DAEMON')
      expect(exec.agentName).to.equal('reconciler')
      expect(exec.cleanupPolicy).to.equal('persistent')
    })

    it('stores orchestrator role correctly', () => {
      const exec = storage.createExecution({
        ticketId: 'ORCH',
        agentName: 'orchestrator-main',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'orchestrator',
      })

      expect(exec.role).to.equal('orchestrator')
    })

    it('retrieves role after getExecution', () => {
      const created = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
      })

      const retrieved = storage.getExecution(created.id)
      expect(retrieved).to.not.be.null
      expect(retrieved!.role).to.equal('daemon')
    })
  })

  // =========================================================================
  // 2. cleanupStaleExecutions skips daemon-role sessions
  // =========================================================================

  describe('cleanupStaleExecutions skips daemons', () => {
    it('does not mark daemon sessions as stopped even without tmux', () => {
      // Create a daemon execution that looks "active" but has no tmux session
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })
      storage.updateStatus(exec.id, 'running')

      // Run cleanup — this would normally mark sessions without tmux as stopped.
      // But daemons should be skipped (they're filtered out in the query).
      const cleaned = storage.cleanupStaleExecutions()

      // The daemon should NOT have been cleaned up
      const afterCleanup = storage.getExecution(exec.id)
      expect(afterCleanup).to.not.be.null
      expect(afterCleanup!.status).to.equal('running')

      // cleaned count should be 0 since the only "active" execution is a daemon
      expect(cleaned).to.equal(0)
    })

    it('cleans regular workers but leaves daemons alone', () => {
      // Create a regular worker with no tmux session (stale)
      const worker = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'worker',
        sessionId: 'TKT-001-work-test-agent',
      })
      storage.updateStatus(worker.id, 'running')

      // Also set started_at to >5 min ago so the no-sessionId path triggers for
      // workers without session IDs. But this worker HAS a sessionId —
      // it'll be checked against tmux and found missing.

      // Create a daemon
      const daemon = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })
      storage.updateStatus(daemon.id, 'running')

      // Run cleanup
      storage.cleanupStaleExecutions()

      // The worker should have been cleaned (no tmux session found)
      const workerAfter = storage.getExecution(worker.id)
      expect(workerAfter!.status).to.equal('stopped')

      // The daemon should still be running
      const daemonAfter = storage.getExecution(daemon.id)
      expect(daemonAfter!.status).to.equal('running')
    })
  })

  // =========================================================================
  // 3. isReconcilerRunning helper
  // =========================================================================

  describe('isReconcilerRunning', () => {
    it('returns false when no daemon executions exist', () => {
      expect(isReconcilerRunning(storage)).to.be.false
    })

    it('returns true when reconciler daemon is running', () => {
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })
      storage.updateStatus(exec.id, 'running')

      expect(isReconcilerRunning(storage)).to.be.true
    })

    it('returns false when reconciler is stopped', () => {
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })
      storage.updateStatus(exec.id, 'stopped')

      expect(isReconcilerRunning(storage)).to.be.false
    })

    it('returns false for worker sessions named reconciler', () => {
      // A worker role should not count as a daemon
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: RECONCILER_SESSION_NAME,
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'worker',
      })
      storage.updateStatus(exec.id, 'running')

      expect(isReconcilerRunning(storage)).to.be.false
    })
  })

  // =========================================================================
  // 4. listExecutions returns role correctly
  // =========================================================================

  describe('listExecutions with role', () => {
    it('returns role in listed executions', () => {
      const daemon = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: RECONCILER_SESSION_NAME,
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
      })
      storage.updateStatus(daemon.id, 'running')

      const worker = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'worker',
      })
      storage.updateStatus(worker.id, 'running')

      const running = storage.listExecutions({ status: 'running' })
      expect(running).to.have.length(2)

      const daemonExec = running.find(e => e.role === 'daemon')
      expect(daemonExec).to.not.be.undefined
      expect(daemonExec!.agentName).to.equal(RECONCILER_SESSION_NAME)

      const workerExec = running.find(e => e.role === 'worker')
      expect(workerExec).to.not.be.undefined
      expect(workerExec!.agentName).to.equal('test-agent')
    })
  })

  // =========================================================================
  // 5. DAEMON_TICKET_ID and RECONCILER_SESSION_NAME constants
  // =========================================================================

  describe('constants', () => {
    it('RECONCILER_SESSION_NAME is "reconciler"', () => {
      expect(RECONCILER_SESSION_NAME).to.equal('reconciler')
    })

    it('DAEMON_TICKET_ID is "DAEMON"', () => {
      expect(DAEMON_TICKET_ID).to.equal('DAEMON')
    })
  })
})
