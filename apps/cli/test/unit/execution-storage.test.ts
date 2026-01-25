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
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'test-session',
      })
      storage.updateStatus('WORK-001', 'completed')

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
      storage.createExecution({
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
      const exec = storage.getExecution('WORK-001')
      expect(exec?.status).to.equal('starting')
    })

    it('cleans up executions with sessionId when session does not exist', () => {
      // Create an execution with a sessionId that won't exist
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'non-existent-session-12345',
      })
      storage.updateStatus('WORK-001', 'running')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      // Verify execution is now stopped
      const exec = storage.getExecution('WORK-001')
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
      storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'fake-session-xyz',
      })
      storage.updateStatus('WORK-001', 'running')

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(3)
    })

    it('handles devcontainer executions with non-existent container sessions', () => {
      // Create an execution with devcontainer environment
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        sandboxed: true,
        containerId: 'abc123def456',
        sessionId: 'container-session',
      })
      storage.updateStatus('WORK-001', 'running')

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
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'busy-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-001', 'running')

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
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'done-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-001', 'completed')

      const available = storage.isAgentAvailable('done-agent')
      expect(available).to.be.true
    })

    it('returns true when agent only has stopped executions', () => {
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'stopped-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-001', 'stopped')

      const available = storage.isAgentAvailable('stopped-agent')
      expect(available).to.be.true
    })

    it('returns true when agent only has failed executions', () => {
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'failed-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-001', 'failed')

      const available = storage.isAgentAvailable('failed-agent')
      expect(available).to.be.true
    })
  })

  describe('createExecution ID generation (TKT-656)', () => {
    it('generates sequential IDs', () => {
      const exec1 = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      expect(exec1.id).to.equal('WORK-001')

      const exec2 = storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      expect(exec2.id).to.equal('WORK-002')
    })

    it('does not reuse IDs after deletion', () => {
      // Create 3 executions
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })

      // Delete the middle one
      storage.deleteExecution('WORK-002')

      // Next ID should be WORK-004, not WORK-003 (which still exists)
      const exec4 = storage.createExecution({
        ticketId: 'TKT-004',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      expect(exec4.id).to.equal('WORK-004')
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
      expect(exec.id).to.equal('WORK-001')
    })

    it('self-heals when sequence is behind existing IDs (migration)', () => {
      // Simulate existing data from before sequence table existed
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          sandboxed, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-010', 'TKT-OLD', 'old-agent', 'claude-code', 'host', 'terminal', 1, 'completed', Date.now())

      // Simulate a broken sequence that was initialized to 1
      db.exec(`
        CREATE TABLE IF NOT EXISTS id_sequences (
          table_name TEXT PRIMARY KEY,
          next_id INTEGER NOT NULL DEFAULT 1
        )
      `)
      db.prepare(`INSERT OR REPLACE INTO id_sequences (table_name, next_id) VALUES ('agent_work', 1)`).run()

      // Now create a new execution - should self-heal and use WORK-011, not WORK-001
      const exec = storage.createExecution({
        ticketId: 'TKT-NEW',
        agentName: 'new-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      expect(exec.id).to.equal('WORK-011')
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
      storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-002', 'running')

      // Create completed execution (should not be returned)
      storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'multi-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
      })
      storage.updateStatus('WORK-003', 'completed')

      const executions = storage.getAgentRunningExecutions('multi-agent')
      expect(executions).to.have.length(2)
      expect(executions.map(e => e.status)).to.include('starting')
      expect(executions.map(e => e.status)).to.include('running')
    })
  })
})
