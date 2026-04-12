import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * Unit tests for session report cleanup decision logic (PRLT-1061)
 *
 * Tests the cleanup policy resolution that happens in `prlt session report`:
 * - on-exit: always clean up
 * - persistent: never clean up
 * - on-error-keep: clean up on success, keep on error
 *
 * Also tests execution status mapping from report status to execution status.
 */
describe('@smoke Session Report Cleanup Logic', () => {
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

  // Helper to mimic the session report's cleanup decision logic
  function shouldCleanupContainer(cleanupPolicy: string, executionStatus: string): { shouldCleanup: boolean; reason: string } {
    switch (cleanupPolicy) {
      case 'on-exit':
        return { shouldCleanup: true, reason: 'cleanup policy is on-exit' }
      case 'persistent':
        return { shouldCleanup: false, reason: 'cleanup policy is persistent' }
      case 'on-error-keep':
        if (executionStatus === 'failed') {
          return { shouldCleanup: false, reason: 'cleanup policy is on-error-keep and execution failed' }
        }
        return { shouldCleanup: true, reason: 'cleanup policy is on-error-keep and execution succeeded' }
      default:
        return { shouldCleanup: true, reason: 'unknown policy, defaulting to cleanup' }
    }
  }

  // Helper to map report status to execution status (mirrors session report logic)
  function mapReportStatusToExecutionStatus(reportStatus: string): 'completed' | 'failed' | 'stopped' {
    switch (reportStatus) {
      case 'completed': return 'completed'
      case 'errored': return 'failed'
      case 'exited':
      case 'started':
      default: return 'stopped'
    }
  }

  describe('status mapping', () => {
    it('maps completed to completed', () => {
      expect(mapReportStatusToExecutionStatus('completed')).to.equal('completed')
    })

    it('maps errored to failed', () => {
      expect(mapReportStatusToExecutionStatus('errored')).to.equal('failed')
    })

    it('maps exited to stopped', () => {
      expect(mapReportStatusToExecutionStatus('exited')).to.equal('stopped')
    })

    it('maps started to stopped', () => {
      expect(mapReportStatusToExecutionStatus('started')).to.equal('stopped')
    })
  })

  describe('on-exit policy', () => {
    it('always cleans up regardless of execution status', () => {
      for (const status of ['completed', 'failed', 'stopped']) {
        const result = shouldCleanupContainer('on-exit', status)
        expect(result.shouldCleanup).to.be.true
      }
    })
  })

  describe('persistent policy', () => {
    it('never cleans up regardless of execution status', () => {
      for (const status of ['completed', 'failed', 'stopped']) {
        const result = shouldCleanupContainer('persistent', status)
        expect(result.shouldCleanup).to.be.false
      }
    })
  })

  describe('on-error-keep policy', () => {
    it('keeps container when execution failed', () => {
      const result = shouldCleanupContainer('on-error-keep', 'failed')
      expect(result.shouldCleanup).to.be.false
    })

    it('cleans up container when execution succeeded', () => {
      const result = shouldCleanupContainer('on-error-keep', 'completed')
      expect(result.shouldCleanup).to.be.true
    })

    it('cleans up container when execution stopped normally', () => {
      const result = shouldCleanupContainer('on-error-keep', 'stopped')
      expect(result.shouldCleanup).to.be.true
    })
  })

  describe('execution record integration', () => {
    it('execution with on-exit policy results in cleanup on exit', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-100',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'on-exit',
      })
      storage.updateStatus(exec.id, 'running')

      // Simulate stop hook: find running execution, check policy
      const executions = storage.getAgentRunningExecutions('test-agent')
      expect(executions).to.have.length(1)
      expect(executions[0].cleanupPolicy).to.equal('on-exit')

      const decision = shouldCleanupContainer(executions[0].cleanupPolicy, 'stopped')
      expect(decision.shouldCleanup).to.be.true
    })

    it('execution with persistent policy keeps container on exit', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-101',
        agentName: 'orchestrator-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'persistent',
      })
      storage.updateStatus(exec.id, 'running')

      const executions = storage.getAgentRunningExecutions('orchestrator-agent')
      expect(executions[0].cleanupPolicy).to.equal('persistent')

      const decision = shouldCleanupContainer(executions[0].cleanupPolicy, 'stopped')
      expect(decision.shouldCleanup).to.be.false
    })

    it('execution with on-error-keep keeps container on error', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-102',
        agentName: 'debug-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'on-error-keep',
      })
      storage.updateStatus(exec.id, 'running')

      const executions = storage.getAgentRunningExecutions('debug-agent')
      expect(executions[0].cleanupPolicy).to.equal('on-error-keep')

      // Error case: keep container
      const errorDecision = shouldCleanupContainer(executions[0].cleanupPolicy, 'failed')
      expect(errorDecision.shouldCleanup).to.be.false

      // Success case: clean up
      const successDecision = shouldCleanupContainer(executions[0].cleanupPolicy, 'completed')
      expect(successDecision.shouldCleanup).to.be.true
    })

    it('execution status is updated after report', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-103',
        agentName: 'status-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
      })
      storage.updateStatus(exec.id, 'running')

      // Simulate stop hook updating status
      const executionStatus = mapReportStatusToExecutionStatus('exited')
      storage.updateStatus(exec.id, executionStatus)

      // Verify status was updated
      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
      expect(updated?.completedAt).to.not.be.undefined

      // Agent should now be available
      expect(storage.isAgentAvailable('status-agent')).to.be.true
    })
  })
})
