import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * Unit tests for ExecutionAttach command
 * Tests the execution lookup and session matching logic used by the attach command
 */
describe('ExecutionAttach', () => {
  let testDir: string
  let db: Database.Database
  let storage: ExecutionStorage

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-attach-test-'))
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

  describe('listing active executions for attach', () => {
    it('returns only running and starting executions', () => {
      // Create executions with different statuses
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-001-Implement-agent-1',
      })

      storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-002-Implement-agent-2',
      })

      storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-003-Implement-agent-3',
      })

      // Set statuses: running, completed, starting
      const executions = storage.listExecutions({ limit: 10 })
      storage.updateStatus(executions[0].id, 'running')
      storage.updateStatus(executions[1].id, 'completed', 0)
      // third stays as 'starting'

      // Only running and starting should be attachable
      const running = storage.listExecutions({ status: 'running' })
      const starting = storage.listExecutions({ status: 'starting' })
      const active = [...running, ...starting]

      expect(active).to.have.length(2)
      const statuses = active.map(e => e.status)
      expect(statuses).to.include('running')
      expect(statuses).to.include('starting')
      expect(statuses).to.not.include('completed')
    })

    it('returns executions with session IDs', () => {
      storage.createExecution({
        ticketId: 'TKT-010',
        agentName: 'altman',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-010-Implement-altman',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const exec = executions[0]

      expect(exec.sessionId).to.equal('TKT-010-Implement-altman')
      expect(exec.environment).to.equal('host')
    })

    it('returns executions with container IDs for devcontainer environment', () => {
      storage.createExecution({
        ticketId: 'TKT-020',
        agentName: 'stout-page',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
        containerId: 'abc123def456',
        sessionId: 'TKT-020-Implement-stout-page',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const exec = executions[0]

      expect(exec.environment).to.equal('devcontainer')
      expect(exec.containerId).to.equal('abc123def456')
      expect(exec.sessionId).to.equal('TKT-020-Implement-stout-page')
    })

    it('returns empty list when no active executions exist', () => {
      const running = storage.listExecutions({ status: 'running' })
      const starting = storage.listExecutions({ status: 'starting' })
      const active = [...running, ...starting]

      expect(active).to.have.length(0)
    })

    it('does not include stopped executions', () => {
      storage.createExecution({
        ticketId: 'TKT-030',
        agentName: 'agent-stopped',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-030-Implement-agent-stopped',
      })

      const executions = storage.listExecutions({ limit: 1 })
      storage.updateStatus(executions[0].id, 'stopped')

      const running = storage.listExecutions({ status: 'running' })
      const starting = storage.listExecutions({ status: 'starting' })
      const active = [...running, ...starting]

      expect(active).to.have.length(0)
    })

    it('does not include failed executions', () => {
      storage.createExecution({
        ticketId: 'TKT-040',
        agentName: 'agent-failed',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-040-Implement-agent-failed',
      })

      const executions = storage.listExecutions({ limit: 1 })
      storage.updateStatus(executions[0].id, 'failed', 1)

      const running = storage.listExecutions({ status: 'running' })
      const starting = storage.listExecutions({ status: 'starting' })
      const active = [...running, ...starting]

      expect(active).to.have.length(0)
    })
  })

  describe('execution lookup by ID', () => {
    it('finds execution by exact ID', () => {
      storage.createExecution({
        ticketId: 'TKT-100',
        agentName: 'agent-lookup',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-100-Implement-agent-lookup',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const execId = executions[0].id

      const exec = storage.getExecution(execId)
      expect(exec).to.not.be.null
      expect(exec!.id).to.equal(execId)
      expect(exec!.ticketId).to.equal('TKT-100')
    })

    it('returns null for non-existent execution', () => {
      const exec = storage.getExecution('WORK-NONEXISTENT')
      expect(exec).to.be.null
    })

    it('finds execution and reads all attach-relevant fields', () => {
      storage.createExecution({
        ticketId: 'TKT-200',
        agentName: 'altman',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
        containerId: 'container-xyz',
        sessionId: 'TKT-200-Implement-altman',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const exec = storage.getExecution(executions[0].id)

      expect(exec).to.not.be.null
      expect(exec!.ticketId).to.equal('TKT-200')
      expect(exec!.agentName).to.equal('altman')
      expect(exec!.environment).to.equal('devcontainer')
      expect(exec!.containerId).to.equal('container-xyz')
      expect(exec!.sessionId).to.equal('TKT-200-Implement-altman')
      expect(exec!.status).to.equal('starting')
    })
  })

  describe('docker environment support', () => {
    it('stores docker environment executions', () => {
      storage.createExecution({
        ticketId: 'TKT-300',
        agentName: 'docker-agent',
        executor: 'claude-code',
        environment: 'docker',
        displayMode: 'background',
        sandboxed: true,
        containerId: 'docker-container-id',
        sessionId: 'TKT-300-Implement-docker-agent',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const exec = executions[0]

      expect(exec.environment).to.equal('docker')
      expect(exec.containerId).to.equal('docker-container-id')
    })
  })

  describe('multiple active executions', () => {
    it('returns all active executions for selection', () => {
      // Create 3 running executions
      for (let i = 1; i <= 3; i++) {
        storage.createExecution({
          ticketId: `TKT-50${i}`,
          agentName: `agent-${i}`,
          executor: 'claude-code',
          environment: 'host',
          displayMode: 'terminal',
          sandboxed: true,
          sessionId: `TKT-50${i}-Implement-agent-${i}`,
        })
      }

      // Set all to running
      const executions = storage.listExecutions({ limit: 10 })
      for (const exec of executions) {
        storage.updateStatus(exec.id, 'running')
      }

      const running = storage.listExecutions({ status: 'running' })
      expect(running).to.have.length(3)

      // Each should have unique ticket IDs
      const ticketIds = running.map(e => e.ticketId)
      expect(new Set(ticketIds).size).to.equal(3)
    })

    it('handles mixed environments in active executions', () => {
      storage.createExecution({
        ticketId: 'TKT-601',
        agentName: 'host-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        sandboxed: true,
        sessionId: 'TKT-601-Implement-host-agent',
      })

      storage.createExecution({
        ticketId: 'TKT-602',
        agentName: 'container-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        sandboxed: true,
        containerId: 'container-abc',
        sessionId: 'TKT-602-Implement-container-agent',
      })

      const executions = storage.listExecutions({ limit: 10 })
      expect(executions).to.have.length(2)

      const environments = executions.map(e => e.environment)
      expect(environments).to.include('host')
      expect(environments).to.include('devcontainer')
    })
  })
})
