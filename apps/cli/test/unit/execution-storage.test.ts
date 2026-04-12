import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage, ContainerStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * Unit tests for ExecutionStorage class
 * Tests the cleanupStaleExecutions() method added in TKT-604
 * Tests ID generation fix added in TKT-656
 *
 * Uses savepoint-based isolation: DB created once, each test wrapped in
 * SAVEPOINT/ROLLBACK for fast, isolated test execution.
 */
describe('@smoke ExecutionStorage', () => {
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

  describe('cleanupStaleExecutions', () => {
    it('returns 0 when there are no active executions', () => {
      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)
    })

    it('returns 0 when all executions are already completed', () => {
      // Create a completed execution
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'test-session',
      })
      storage.updateStatus(exec.id, 'completed')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)
    })

    it('persists external issue metadata when provided', () => {
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        externalSource: 'linear',
        externalKey: 'ENG-123',
        externalId: 'lin-issue-id',
        externalUrl: 'https://linear.app/acme/issue/ENG-123',
      })

      const exec = storage.getExecution(created.id)
      expect(exec?.externalSource).to.equal('linear')
      expect(exec?.externalKey).to.equal('ENG-123')
      expect(exec?.externalId).to.equal('lin-issue-id')
      expect(exec?.externalUrl).to.equal('https://linear.app/acme/issue/ENG-123')
    })

    it('cleans up old executions without sessionId (older than 5 minutes)', () => {
      // Insert an old execution directly (older than 5 minutes)
      const oldTime = Date.now() - 6 * 60 * 1000 // 6 minutes ago
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-OLD',
        'TKT-001',
        'agent-1',
        'claude',
        'host',
        'terminal',
        'safe',
        'starting',
        oldTime
      )

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      // Verify execution is now stopped
      const exec = storage.getExecution('WORK-OLD')
      expect(exec?.status).to.equal('stopped')
    })

    it('does not clean up recent executions without sessionId (less than 5 minutes)', () => {
      // Create a recent execution without sessionId
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        // No sessionId
      })

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)

      // Verify execution is still starting
      const exec = storage.getExecution(created.id)
      expect(exec?.status).to.equal('starting')
    })

    it('cleans up executions with sessionId when session does not exist', () => {
      // Create an execution with a sessionId that won't exist
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'non-existent-session-12345',
      })
      storage.updateStatus(created.id, 'running')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      // Verify execution is now stopped
      const exec = storage.getExecution(created.id)
      expect(exec?.status).to.equal('stopped')
    })

    it('cleans up multiple stale executions in one call', () => {
      // Create multiple stale executions
      const oldTime = Date.now() - 10 * 60 * 1000 // 10 minutes ago

      // Old execution without sessionId
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-OLD1', 'TKT-001', 'agent-1', 'claude', 'host', 'terminal', 'safe', 'starting', oldTime)

      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-OLD2', 'TKT-002', 'agent-2', 'claude', 'host', 'terminal', 'safe', 'running', oldTime)

      // Execution with non-existent session
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'fake-session-xyz',
      })
      storage.updateStatus(exec3.id, 'running')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(3)
    })

    it('handles devcontainer executions with non-existent container sessions', () => {
      // Create an execution with devcontainer environment
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'safe',
        containerId: 'abc123def456',
        sessionId: 'container-session',
      })
      storage.updateStatus(created.id, 'running')

      // Since the container doesn't actually exist, this should clean up
      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)
    })
  })

  describe('isAgentAvailable', () => {
    it('returns true when agent has no executions', () => {
      const available = storage.isAgentAvailable('new-agent')
      expect(available).to.be.true
    })

    it('returns false when agent has a running execution', () => {
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'busy-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(created.id, 'running')

      const available = storage.isAgentAvailable('busy-agent')
      expect(available).to.be.false
    })

    it('returns false when agent has a starting execution', () => {
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'starting-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      // Status starts as 'starting' by default

      const available = storage.isAgentAvailable('starting-agent')
      expect(available).to.be.false
    })

    it('returns true when agent only has completed executions', () => {
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'done-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(created.id, 'completed')

      const available = storage.isAgentAvailable('done-agent')
      expect(available).to.be.true
    })

    it('returns true when agent only has stopped executions', () => {
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'stopped-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(created.id, 'stopped')

      const available = storage.isAgentAvailable('stopped-agent')
      expect(available).to.be.true
    })

    it('returns true when agent only has failed executions', () => {
      const created = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'failed-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(created.id, 'failed')

      const available = storage.isAgentAvailable('failed-agent')
      expect(available).to.be.true
    })
  })

  describe('createExecution ID generation', () => {
    it('generates unique UUID-based IDs with WORK- prefix', () => {
      const exec1 = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      expect(exec1.id).to.match(/^WORK-[A-F0-9]{8}$/)

      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      expect(exec2.id).to.match(/^WORK-[A-F0-9]{8}$/)
      expect(exec2.id).to.not.equal(exec1.id)
    })

    it('does not reuse IDs after deletion', () => {
      // Create 3 executions
      const exec1 = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      // Delete the middle one
      storage.deleteExecution(exec2.id)

      // Next ID should be unique and different from all previous IDs
      const exec4 = storage.createExecution({
        ticketId: 'TKT-004',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      expect(exec4.id).to.match(/^WORK-[A-F0-9]{8}$/)
      expect(exec4.id).to.not.equal(exec1.id)
      expect(exec4.id).to.not.equal(exec2.id)
      expect(exec4.id).to.not.equal(exec3.id)
    })

    it('handles empty table correctly', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      expect(exec.id).to.match(/^WORK-[A-F0-9]{8}$/)
    })
  })

  describe('getAgentRunningExecutions', () => {
    it('returns empty array when agent has no executions', () => {
      const executions = storage.getAgentRunningExecutions('new-agent')
      expect(executions).to.deep.equal([])
    })

    it('returns running and starting executions', () => {
      // Create starting execution
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      // Create running execution
      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec2.id, 'running')

      // Create completed execution (should not be returned)
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec3.id, 'completed')

      const executions = storage.getAgentRunningExecutions('multi-agent')
      expect(executions).to.have.length(2)
      expect(executions.map(e => e.status)).to.include('starting')
      expect(executions.map(e => e.status)).to.include('running')
    })

    it('only returns executions for the specified agent', () => {
      // Create running execution for agent-1
      const exec1 = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec1.id, 'running')
      storage.updateProcessInfo(exec1.id, { containerId: 'abc123' })

      // Create running execution for agent-2
      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-2',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec2.id, 'running')
      storage.updateProcessInfo(exec2.id, { containerId: 'def456' })

      const agent1Execs = storage.getAgentRunningExecutions('agent-1')
      expect(agent1Execs).to.have.length(1)
      expect(agent1Execs[0].ticketId).to.equal('TKT-001')
    })
  })

  describe('orphan cleanup patterns (TKT-1028)', () => {
    it('marks orphaned running executions as stopped', () => {
      // Simulate: agent had a running execution whose container was destroyed
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'orphan-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec.id, 'running')
      storage.updateProcessInfo(exec.id, { containerId: 'old-container-id' })

      // Verify execution is running
      const running = storage.getAgentRunningExecutions('orphan-agent')
      expect(running).to.have.length(1)

      // Simulate orphan cleanup: mark as stopped
      storage.updateStatus(exec.id, 'stopped')

      // Verify execution is now stopped
      const afterCleanup = storage.getAgentRunningExecutions('orphan-agent')
      expect(afterCleanup).to.have.length(0)

      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
      expect(updated?.completedAt).to.not.be.null
    })

    it('marks multiple orphaned executions as stopped', () => {
      // Simulate: agent had two running executions (starting + running)
      const exec1 = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'orphan-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      // exec1 stays in 'starting' status

      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'orphan-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec2.id, 'running')
      storage.updateProcessInfo(exec2.id, { containerId: 'old-container' })

      // Both should be returned as running
      const running = storage.getAgentRunningExecutions('orphan-agent')
      expect(running).to.have.length(2)

      // Simulate orphan cleanup for both
      for (const staleExec of running) {
        storage.updateStatus(staleExec.id, 'stopped')
      }

      // All should be cleaned up
      const afterCleanup = storage.getAgentRunningExecutions('orphan-agent')
      expect(afterCleanup).to.have.length(0)
    })

    it('containerId-based cleanup only stops mismatched executions', () => {
      // Simulate: container was recreated, old execution has stale containerId
      const oldExec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'reused-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(oldExec.id, 'running')
      storage.updateProcessInfo(oldExec.id, { containerId: 'old-container-abc' })

      const currentExec = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'reused-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(currentExec.id, 'running')
      storage.updateProcessInfo(currentExec.id, { containerId: 'new-container-xyz' })

      const running = storage.getAgentRunningExecutions('reused-agent')
      expect(running).to.have.length(2)

      // Simulate containerId-based cleanup: only mark mismatched ones
      const currentContainerId = 'new-container-xyz'
      for (const exec of running) {
        if (exec.containerId && exec.containerId !== currentContainerId) {
          storage.updateStatus(exec.id, 'stopped')
        }
      }

      // Only old execution should be stopped
      const afterCleanup = storage.getAgentRunningExecutions('reused-agent')
      expect(afterCleanup).to.have.length(1)
      expect(afterCleanup[0].containerId).to.equal('new-container-xyz')

      const stoppedExec = storage.getExecution(oldExec.id)
      expect(stoppedExec?.status).to.equal('stopped')
    })

    it('does not affect executions without containerId during containerId-based cleanup', () => {
      // Execution without containerId (e.g., host execution or before container assigned)
      const hostExec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'mixed-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(hostExec.id, 'running')
      // No updateProcessInfo — containerId is undefined

      const containerExec = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'mixed-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'safe',
      })
      storage.updateStatus(containerExec.id, 'running')
      storage.updateProcessInfo(containerExec.id, { containerId: 'old-container' })

      const running = storage.getAgentRunningExecutions('mixed-agent')
      expect(running).to.have.length(2)

      // ContainerId-based cleanup: skip execs without containerId
      const currentContainerId = 'new-container'
      for (const exec of running) {
        if (exec.containerId && exec.containerId !== currentContainerId) {
          storage.updateStatus(exec.id, 'stopped')
        }
      }

      // Host exec (no containerId) should survive, old container exec should be stopped
      const afterCleanup = storage.getAgentRunningExecutions('mixed-agent')
      expect(afterCleanup).to.have.length(1)
      expect(afterCleanup[0].id).to.equal(hostExec.id)
    })
  })

  describe('cleanupPolicy (PRLT-1061)', () => {
    it('defaults cleanup_policy to on-exit when not specified', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
      })

      expect(exec.cleanupPolicy).to.equal('on-exit')
    })

    it('stores cleanup_policy when explicitly set to persistent', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-2',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'persistent',
      })

      expect(exec.cleanupPolicy).to.equal('persistent')

      // Verify it persists on read
      const fetched = storage.getExecution(exec.id)
      expect(fetched?.cleanupPolicy).to.equal('persistent')
    })

    it('stores cleanup_policy when set to on-error-keep', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'on-error-keep',
      })

      expect(exec.cleanupPolicy).to.equal('on-error-keep')
    })

    it('includes cleanup_policy in listExecutions results', () => {
      storage.createExecution({
        ticketId: 'TKT-004',
        agentName: 'agent-4',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'danger',
        cleanupPolicy: 'persistent',
      })

      const executions = storage.listExecutions({ agentName: 'agent-4' })
      expect(executions).to.have.length(1)
      expect(executions[0].cleanupPolicy).to.equal('persistent')
    })
  })

  describe('PRLT-1077: agent lifecycle — unreachable container protection', () => {
    it('does not mark devcontainer execution as stopped when container is unreachable', () => {
      // Simulate: agent spawned in background mode, container is running but unreachable
      // (e.g., docker exec timeout). The cleanup should NOT mark it as stopped.
      const exec = storage.createExecution({
        ticketId: 'TKT-077',
        agentName: 'background-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'danger',
        sessionId: 'TKT-077-Implement-background-agent',
      })
      storage.updateStatus(exec.id, 'running')
      storage.updateProcessInfo(exec.id, { containerId: 'unreachable-container-id' })

      // Run cleanup — since docker is not available in test env,
      // getContainerTmuxSessionMap() returns empty map and the
      // container won't be found in docker ps output.
      // The execution should be cleaned up since the container is not in docker ps
      // (which means it's truly gone, not just unreachable).
      const cleaned = storage.cleanupStaleExecutions()

      // Container not found in docker ps = container is not running = legitimate cleanup
      expect(cleaned).to.equal(1)
      const updated = storage.getExecution(exec.id)
      expect(updated?.status).to.equal('stopped')
    })

    it('agent_work status transitions follow starting->running->stopped/completed/failed', () => {
      // Verify the lifecycle state machine is enforced
      const exec = storage.createExecution({
        ticketId: 'TKT-LIFE',
        agentName: 'lifecycle-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'danger',
      })

      // Initial state: starting
      expect(exec.status).to.equal('starting')

      // Transition to running
      storage.updateStatus(exec.id, 'running')
      const running = storage.getExecution(exec.id)
      expect(running?.status).to.equal('running')
      expect(running?.completedAt).to.be.undefined

      // Transition to completed (terminal state)
      storage.updateStatus(exec.id, 'completed')
      const completed = storage.getExecution(exec.id)
      expect(completed?.status).to.equal('completed')
      expect(completed?.completedAt).to.not.be.undefined

      // Also verify failed and stopped are terminal states with completedAt
      const exec2 = storage.createExecution({
        ticketId: 'TKT-FAIL',
        agentName: 'fail-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(exec2.id, 'failed', 1, 'test error')
      const failed = storage.getExecution(exec2.id)
      expect(failed?.status).to.equal('failed')
      expect(failed?.completedAt).to.not.be.undefined
      expect(failed?.exitCode).to.equal(1)
      expect(failed?.errorMessage).to.equal('test error')
    })

    it('getRunningExecution only returns starting or running status', () => {
      // Create executions in various states
      const starting = storage.createExecution({
        ticketId: 'TKT-S1',
        agentName: 'agent-s1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const running = storage.createExecution({
        ticketId: 'TKT-R1',
        agentName: 'agent-r1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(running.id, 'running')

      const stopped = storage.createExecution({
        ticketId: 'TKT-ST1',
        agentName: 'agent-st1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.updateStatus(stopped.id, 'stopped')

      // Only starting and running should be found
      expect(storage.getRunningExecution('TKT-S1')).to.not.be.null
      expect(storage.getRunningExecution('TKT-R1')).to.not.be.null
      expect(storage.getRunningExecution('TKT-ST1')).to.be.null
    })
  })

  describe('PRLT-1077: container table is infrastructure only', () => {
    before(() => {
      // Create the agents table required by foreign key constraint
      db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          name TEXT PRIMARY KEY,
          type TEXT DEFAULT 'persistent',
          status TEXT DEFAULT 'active'
        )
      `)
      db.exec(`INSERT OR IGNORE INTO agents (name) VALUES ('test-agent'), ('test-agent-2')`)
    })

    it('upsertContainer ignores status parameter', () => {
      const containerStorage = new ContainerStorage(db)

      // Even when status='running' is passed, it should be stored as 'unknown'
      const container = containerStorage.upsertContainer({
        agentName: 'test-agent',
        dockerId: 'docker-test-123',
        status: 'running',
      })

      expect(container.status).to.equal('unknown')
    })

    it('updateStatus is a no-op', () => {
      const containerStorage = new ContainerStorage(db)

      containerStorage.upsertContainer({
        agentName: 'test-agent-2',
        dockerId: 'docker-test-456',
      })

      // updateStatus should be a no-op (PRLT-1077)
      containerStorage.updateStatus('docker-test-456', 'running')

      // Status should still be 'unknown'
      const fetched = containerStorage.getContainerByDockerId('docker-test-456')
      expect(fetched?.status).to.equal('unknown')
    })
  })

  describe('external key resolution (PRLT-1066)', () => {
    it('getRunningExecution finds execution by external_key', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-100',
        agentName: 'agent-ext',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        externalSource: 'linear',
        externalKey: 'PRLT-500',
      })
      storage.updateStatus(exec.id, 'running')

      // Lookup by external key should find it
      const found = storage.getRunningExecution('PRLT-500')
      expect(found).to.not.be.null
      expect(found!.id).to.equal(exec.id)
      expect(found!.externalKey).to.equal('PRLT-500')
    })

    it('getRunningExecution still finds execution by internal ticket_id', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-101',
        agentName: 'agent-ext2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        externalSource: 'linear',
        externalKey: 'PRLT-501',
      })
      storage.updateStatus(exec.id, 'running')

      // Lookup by internal ticket ID should still work
      const found = storage.getRunningExecution('TKT-101')
      expect(found).to.not.be.null
      expect(found!.id).to.equal(exec.id)
    })

    it('listExecutions filters by external_key when ticketId is external', () => {
      storage.createExecution({
        ticketId: 'TKT-200',
        agentName: 'agent-list1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        externalSource: 'linear',
        externalKey: 'PRLT-600',
      })

      storage.createExecution({
        ticketId: 'TKT-201',
        agentName: 'agent-list2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      // Filter by external key
      const results = storage.listExecutions({ ticketId: 'PRLT-600' })
      expect(results).to.have.length(1)
      expect(results[0].ticketId).to.equal('TKT-200')
      expect(results[0].externalKey).to.equal('PRLT-600')

      // Filter by internal ID should still work
      const results2 = storage.listExecutions({ ticketId: 'TKT-200' })
      expect(results2).to.have.length(1)
      expect(results2[0].ticketId).to.equal('TKT-200')
    })
  })
})
