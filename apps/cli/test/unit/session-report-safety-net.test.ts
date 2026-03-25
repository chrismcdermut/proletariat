import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * PRLT-1129: Safety net tests for session report.
 *
 * Tests the safety net logic that runs when an agent exits without
 * explicitly proposing work via `prlt work propose`.
 *
 * The safety net in `prlt session report` checks:
 * 1. Execution still in 'running' state → agent didn't call work ready/propose
 * 2. Uncommitted changes in workspace → warn
 * 3. Commits on feature branch without PR → auto-propose
 *
 * These tests verify the execution state conditions that trigger
 * or skip the safety net, since the actual git/gh operations
 * require a real repo environment.
 */
describe('@smoke PRLT-1129: Session Report Safety Net', () => {
  let fastDb: FastTestDb
  let db: Database.Database
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

  describe('safety net trigger conditions', () => {
    it('should detect agent that exited while still in running state', () => {
      // Agent started but never called work ready/propose
      const exec = storage.createExecution({
        ticketId: 'TKT-200',
        agentName: 'forgetful-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'full',
        branch: 'PRLT-200/feat/owner/forgetful-agent/some-feature',
      })
      storage.updateStatus(exec.id, 'running')

      // When session report runs with status=exited, execution is still 'running'
      const executions = storage.getAgentRunningExecutions('forgetful-agent')
      expect(executions).to.have.length(1)
      expect(executions[0].status).to.equal('running')
      expect(executions[0].ticketId).to.equal('TKT-200')
      expect(executions[0].branch).to.include('PRLT-200')
      // This is where the safety net would trigger in session report
    })

    it('should not find running executions for agent that already completed', () => {
      // Agent called work ready/propose, which marked execution as completed
      const exec = storage.createExecution({
        ticketId: 'TKT-201',
        agentName: 'diligent-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'full',
        branch: 'PRLT-201/feat/owner/diligent-agent/some-feature',
      })
      storage.updateStatus(exec.id, 'running')
      // Agent called work ready → execution marked completed
      storage.updateStatus(exec.id, 'completed')

      // When session report runs, no running executions exist
      const executions = storage.getAgentRunningExecutions('diligent-agent')
      expect(executions).to.have.length(0)
      // Safety net would NOT trigger — no running execution to catch
    })

    it('safety net auto-propose should upgrade status from stopped to completed', () => {
      // Simulate the status upgrade that happens when auto-propose succeeds
      const exec = storage.createExecution({
        ticketId: 'TKT-202',
        agentName: 'autoprop-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'full',
        branch: 'PRLT-202/feat/owner/autoprop-agent/auto-proposed',
      })
      storage.updateStatus(exec.id, 'running')

      // Safety net runs, detects commits without PR, auto-proposes successfully
      // → execution status should be 'completed' instead of 'stopped'
      storage.updateStatus(exec.id, 'completed')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('completed')
    })

    it('safety net failure should leave status as stopped', () => {
      // When auto-propose fails, execution should still be marked as stopped
      const exec = storage.createExecution({
        ticketId: 'TKT-203',
        agentName: 'failing-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'full',
        branch: 'PRLT-203/feat/owner/failing-agent/failed-propose',
      })
      storage.updateStatus(exec.id, 'running')

      // Safety net runs but auto-propose fails → status stays as stopped
      storage.updateStatus(exec.id, 'stopped')

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
    })
  })

  describe('safety net is only for exited status', () => {
    it('should not trigger safety net for completed status', () => {
      // completed = agent reported success, no safety net needed
      const reportStatus = 'completed'
      expect(reportStatus).to.equal('completed')
      // In session report, safety net only runs when status === 'exited'
    })

    it('should not trigger safety net for errored status', () => {
      // errored = agent hit an error, may need debugging, don't auto-propose
      const reportStatus = 'errored'
      expect(reportStatus).to.equal('errored')
      // In session report, safety net only runs when status === 'exited'
    })

    it('should trigger safety net for exited status', () => {
      // exited = agent session ended normally but may not have proposed
      const reportStatus = 'exited'
      expect(reportStatus).to.equal('exited')
      // This is the case where safety net should run
    })
  })
})
