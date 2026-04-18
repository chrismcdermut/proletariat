import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * PRLT-1337: Execution lifecycle tests
 *
 * Verifies that agent_work status transitions correctly:
 * - completed_at is written on completion
 * - exit_code is written on completion
 * - Status transitions from running -> completed/failed
 * - Session prune (cleanupStaleExecutions) updates agent_work rows
 * - Execution counts are accurate for work status
 */

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
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
      lifecycle_state TEXT,
      retries INTEGER DEFAULT 0
    )
  `)
  return db
}

describe('@smoke Execution Lifecycle (PRLT-1337)', () => {
  let db: Database.Database
  let storage: ExecutionStorage

  beforeEach(() => {
    db = createTestDb()
    storage = new ExecutionStorage(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('completion updates agent_work correctly', () => {
    it('sets status to completed with exit code 0', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-100',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      // Simulate executor completing successfully (exit code 0)
      storage.updateStatus(exec.id, 'completed', 0)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('completed')
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.exitCode).to.equal(0)
    })

    it('sets status to failed with non-zero exit code', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-101',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      storage.updateStatus(exec.id, 'failed', 1)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('failed')
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.exitCode).to.equal(1)
    })

    it('sets status to failed with exit code and error message', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-102',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      storage.updateStatus(exec.id, 'failed', 137, 'OOM killed')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('failed')
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.exitCode).to.equal(137)
      expect(updated?.errorMessage).to.equal('OOM killed')
    })

    it('does not set completedAt when transitioning to running', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-103',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateStatus(exec.id, 'running')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('running')
      expect(updated?.completedAt).to.be.undefined
    })

    it('sets completedAt for stopped status', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-104',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')
      storage.updateStatus(exec.id, 'stopped')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
      expect(updated?.completedAt).to.not.be.undefined
    })
  })

  describe('tryUpdateStatus handles completion with exit code', () => {
    it('returns true and writes exit code on successful update', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-200',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')

      const success = storage.tryUpdateStatus(exec.id, 'completed', 0)
      expect(success).to.be.true

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('completed')
      expect(updated?.exitCode).to.equal(0)
      expect(updated?.completedAt).to.not.be.undefined
    })
  })

  describe('session prune updates agent_work via cleanupStaleExecutions', () => {
    it('marks stale sessions without sessionId as stopped with completedAt', () => {
      const oldTime = Date.now() - 6 * 60 * 1000
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-STALE1', 'PRLT-300', 'stale-agent', 'claude-code',
        'host', 'terminal', 'safe', 'running', oldTime
      )

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      const exec = storage.getExecution('WORK-STALE1')
      expect(exec?.status).to.equal('stopped')
      expect(exec?.completedAt).to.not.be.undefined
    })

    it('marks execution as stopped when tmux session is gone', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-301',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'non-existent-session-prlt1337',
      })
      storage.updateStatus(exec.id, 'running')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
      expect(updated?.completedAt).to.not.be.undefined
    })

    it('does not touch already-completed executions', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-302',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'completed', 0)

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('completed')
    })
  })

  describe('execution counts for work status accuracy', () => {
    it('counts executions by status accurately', () => {
      const exec1 = storage.createExecution({
        ticketId: 'PRLT-400',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      // starting status

      const exec2 = storage.createExecution({
        ticketId: 'PRLT-401',
        agentName: 'agent-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec2.id, 'running')

      const exec3 = storage.createExecution({
        ticketId: 'PRLT-402',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec3.id, 'completed', 0)

      const exec4 = storage.createExecution({
        ticketId: 'PRLT-403',
        agentName: 'agent-4',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec4.id, 'failed', 1)

      const exec5 = storage.createExecution({
        ticketId: 'PRLT-404',
        agentName: 'agent-5',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec5.id, 'stopped')

      expect(storage.listExecutions({ status: 'starting' })).to.have.length(1)
      expect(storage.listExecutions({ status: 'running' })).to.have.length(1)
      expect(storage.listExecutions({ status: 'completed' })).to.have.length(1)
      expect(storage.listExecutions({ status: 'failed' })).to.have.length(1)
      expect(storage.listExecutions({ status: 'stopped' })).to.have.length(1)

      // Suppress unused variable warnings
      void exec1
      void exec5
    })
  })

  describe('heartbeat timeout sets completion fields', () => {
    it('markHeartbeatTimeout sets status=failed, completed_at, and error message', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-500',
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
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.errorMessage).to.include('Heartbeat timeout')
    })
  })

  describe('full spawn-to-completion lifecycle', () => {
    it('starting -> running -> completed with exit code 0', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-600',
        agentName: 'lifecycle-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'test-session-600',
      })
      expect(exec.status).to.equal('starting')
      expect(exec.completedAt).to.be.undefined
      expect(exec.exitCode).to.be.undefined

      storage.updateStatus(exec.id, 'running')
      const running = storage.getExecution(exec.id)
      expect(running?.status).to.equal('running')
      expect(running?.completedAt).to.be.undefined

      storage.updateStatus(exec.id, 'completed', 0)
      const completed = storage.getExecution(exec.id)
      expect(completed?.status).to.equal('completed')
      expect(completed?.completedAt).to.not.be.undefined
      expect(completed?.exitCode).to.equal(0)

      expect(storage.getRunningExecution('PRLT-600')).to.be.null
      expect(storage.isAgentAvailable('lifecycle-agent')).to.be.true
    })

    it('starting -> running -> failed with non-zero exit code', () => {
      const exec = storage.createExecution({
        ticketId: 'PRLT-601',
        agentName: 'fail-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      storage.updateStatus(exec.id, 'running')
      storage.updateStatus(exec.id, 'failed', 1, 'Agent crashed')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('failed')
      expect(updated?.completedAt).to.not.be.undefined
      expect(updated?.exitCode).to.equal(1)
      expect(updated?.errorMessage).to.equal('Agent crashed')

      expect(storage.isAgentAvailable('fail-agent')).to.be.true
    })
  })
})
