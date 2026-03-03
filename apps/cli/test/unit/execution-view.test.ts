import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'

/**
 * Unit tests for ExecutionView command
 * Tests the getExecution() method used by the view command
 */
describe('ExecutionView', () => {
  let testDir: string
  let db: Database.Database
  let storage: ExecutionStorage

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-view-test-'))
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
        permission_mode TEXT DEFAULT 'safe',
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

  describe('getExecution', () => {
    it('returns null for non-existent execution', () => {
      const exec = storage.getExecution('WORK-999')
      expect(exec).to.be.null
    })

    it('returns execution with all basic fields', () => {
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'agent-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const execId = executions[0].id

      const exec = storage.getExecution(execId)
      expect(exec).to.not.be.null
      expect(exec!.ticketId).to.equal('TKT-001')
      expect(exec!.agentName).to.equal('agent-1')
      expect(exec!.executor).to.equal('claude-code')
      expect(exec!.environment).to.equal('host')
      expect(exec!.displayMode).to.equal('terminal')
      expect(exec!.permissionMode).to.equal('safe')
      expect(exec!.status).to.equal('starting')
      expect(exec!.startedAt).to.be.instanceOf(Date)
    })

    it('returns execution with optional fields', () => {
      storage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'agent-2',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'background',
        permissionMode: 'danger',
        branch: 'TKT-002/feat/user/agent-2/test-branch',
        pid: '12345',
        containerId: 'abc123def',
        sessionId: 'prlt-TKT-002-implement',
        host: 'localhost',
        logPath: '/tmp/execution.log',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const execId = executions[0].id

      const exec = storage.getExecution(execId)
      expect(exec).to.not.be.null
      expect(exec!.environment).to.equal('devcontainer')
      expect(exec!.displayMode).to.equal('background')
      expect(exec!.permissionMode).to.equal('danger')
      expect(exec!.branch).to.equal('TKT-002/feat/user/agent-2/test-branch')
      expect(exec!.pid).to.equal('12345')
      expect(exec!.containerId).to.equal('abc123def')
      expect(exec!.sessionId).to.equal('prlt-TKT-002-implement')
      expect(exec!.host).to.equal('localhost')
      expect(exec!.logPath).to.equal('/tmp/execution.log')
    })

    it('returns execution with completion info', () => {
      storage.createExecution({
        ticketId: 'TKT-003',
        agentName: 'agent-3',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const execId = executions[0].id

      storage.updateStatus(execId, 'completed', 0)

      const exec = storage.getExecution(execId)
      expect(exec).to.not.be.null
      expect(exec!.status).to.equal('completed')
      expect(exec!.exitCode).to.equal(0)
      expect(exec!.completedAt).to.be.instanceOf(Date)
    })

    it('returns execution with failed status and exit code', () => {
      storage.createExecution({
        ticketId: 'TKT-004',
        agentName: 'agent-4',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const executions = storage.listExecutions({ limit: 1 })
      const execId = executions[0].id

      storage.updateStatus(execId, 'failed', 1)

      const exec = storage.getExecution(execId)
      expect(exec).to.not.be.null
      expect(exec!.status).to.equal('failed')
      expect(exec!.exitCode).to.equal(1)
    })

    it('returns different executor types', () => {
      const executorTypes = ['claude-code', 'codex', 'aider', 'custom'] as const

      for (const executor of executorTypes) {
        storage.createExecution({
          ticketId: `TKT-${executor}`,
          agentName: 'agent-executor',
          executor,
          environment: 'host',
          displayMode: 'terminal',
          permissionMode: 'safe',
        })
      }

      const executions = storage.listExecutions({ limit: 10 })
      expect(executions).to.have.length(4)

      for (const exec of executions) {
        expect(executorTypes).to.include(exec.executor)
      }
    })

    it('returns different environment types', () => {
      const environments = ['host', 'devcontainer', 'docker', 'vm'] as const

      for (const environment of environments) {
        storage.createExecution({
          ticketId: `TKT-${environment}`,
          agentName: 'agent-env',
          executor: 'claude-code',
          environment,
          displayMode: 'terminal',
          permissionMode: 'safe',
        })
      }

      const executions = storage.listExecutions({ limit: 10 })
      expect(executions).to.have.length(4)

      for (const exec of executions) {
        expect(environments).to.include(exec.environment)
      }
    })

    it('returns different display modes', () => {
      const displayModes = ['terminal', 'background', 'foreground'] as const

      for (const displayMode of displayModes) {
        storage.createExecution({
          ticketId: `TKT-${displayMode}`,
          agentName: 'agent-display',
          executor: 'claude-code',
          environment: 'host',
          displayMode,
          permissionMode: 'safe',
        })
      }

      const executions = storage.listExecutions({ limit: 10 })
      expect(executions).to.have.length(3)

      for (const exec of executions) {
        expect(displayModes).to.include(exec.displayMode)
      }
    })
  })

  describe('listExecutions for view selection', () => {
    it('returns executions ordered by start time descending', () => {
      // Create executions with different start times
      const now = Date.now()

      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-OLD', 'TKT-001', 'agent-1', 'claude-code', 'host', 'terminal', 'safe', 'completed', now - 10000)

      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-NEW', 'TKT-002', 'agent-2', 'claude-code', 'host', 'terminal', 'safe', 'running', now)

      const executions = storage.listExecutions({ limit: 10 })
      expect(executions[0].id).to.equal('WORK-NEW')
      expect(executions[1].id).to.equal('WORK-OLD')
    })

    it('returns executions with all statuses for view command', () => {
      const statuses = ['starting', 'running', 'completed', 'failed', 'stopped']

      for (const status of statuses) {
        const exec = storage.createExecution({
          ticketId: `TKT-${status}`,
          agentName: 'agent-status',
          executor: 'claude-code',
          environment: 'host',
          displayMode: 'terminal',
          permissionMode: 'safe',
        })

        if (status !== 'starting') {
          storage.updateStatus(exec.id, status as 'running' | 'completed' | 'failed' | 'stopped')
        }
      }

      // View command should show all statuses (unlike logs/stop which filter)
      const executions = storage.listExecutions({ limit: 20 })
      expect(executions).to.have.length(5)

      const returnedStatuses = executions.map(e => e.status)
      for (const status of statuses) {
        expect(returnedStatuses).to.include(status)
      }
    })
  })
})
