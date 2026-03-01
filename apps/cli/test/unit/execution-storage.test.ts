import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * Unit tests for ExecutionStorage class
 * Tests the cleanupStaleExecutions() method added in TKT-604
 * Tests ID generation fix added in TKT-656
 */
describe('ExecutionStorage', () => {
  let testDir: string
  let db: Database.Database
  let storage: ExecutionStorage

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-storage-test-'))
    const dbPath = path.join(testDir, 'test.db')
    db = new Database(dbPath)

    // Create the agent_work table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.agent_work} (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        executor TEXT NOT NULL,
        environment TEXT DEFAULT 'host',
        display_mode TEXT DEFAULT 'terminal',
        sandboxed INTEGER DEFAULT 1,
        status TEXT NOT NULL,
        branch TEXT,
        pid TEXT,
        container_id TEXT,
        session_id TEXT,
        host TEXT,
        log_path TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER
      )
    `)

    storage = new ExecutionStorage(db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
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
        sandboxed: true,
        sessionId: 'test-session',
      })
      storage.updateStatus(exec.id, 'completed')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)
    })

    it('cleans up old executions without sessionId (older than 5 minutes)', () => {
      // Insert an old execution directly (older than 5 minutes)
      const oldTime = Date.now() - 6 * 60 * 1000 // 6 minutes ago
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          sandboxed, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'WORK-OLD',
        'TKT-001',
        'agent-1',
        'claude',
        'host',
        'terminal',
        1,
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
        sandboxed: true,
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
        sandboxed: true,
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
          sandboxed, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-OLD1', 'TKT-001', 'agent-1', 'claude', 'host', 'terminal', 1, 'starting', oldTime)

      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          sandboxed, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-OLD2', 'TKT-002', 'agent-2', 'claude', 'host', 'terminal', 1, 'running', oldTime)

      // Execution with non-existent session
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
      })
      expect(exec1.id).to.match(/^WORK-[A-F0-9]{8}$/)

      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
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
        sandboxed: true,
      })
      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
      })

      // Create running execution
      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus(exec2.id, 'running')

      // Create completed execution (should not be returned)
      const exec3 = storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
        sandboxed: true,
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
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'orphan-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
      })
      // _exec1 stays in 'starting' status

      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'orphan-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
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
        sandboxed: true,
      })
      storage.updateStatus(oldExec.id, 'running')
      storage.updateProcessInfo(oldExec.id, { containerId: 'old-container-abc' })

      const currentExec = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'reused-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
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
        sandboxed: true,
      })
      storage.updateStatus(hostExec.id, 'running')
      // No updateProcessInfo — containerId is undefined

      const containerExec = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'mixed-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
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
})
