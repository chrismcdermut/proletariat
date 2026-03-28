import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { getAvailableAgents, selectAgent, resolveOutputMode } from '../../src/lib/execution/spawner.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import type { WorkspaceInfo } from '../../src/lib/agents/commands.js'
import type { Agent } from '../../src/lib/database/index.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * Unit tests for spawner functions
 * Tests getAvailableAgents() staff agent filtering (TKT-604)
 *
 * Uses savepoint-based isolation for fast test execution.
 */
describe('Spawner', () => {
  let fastDb: FastTestDb
  let db: Database.Database
  let executionStorage: ExecutionStorage

  // Helper to create a mock Agent
  function createMockAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      name: 'test-agent',
      type: 'persistent',
      status: 'active',
      base_name: null,
      theme_id: null,
      worktree_path: null,
      mount_mode: 'worktree',
      created_at: new Date().toISOString(),
      cleaned_at: null,
      ...overrides,
    }
  }

  // Helper to create a mock WorkspaceInfo
  function createMockWorkspaceInfo(agents: Agent[]): WorkspaceInfo {
    return {
      path: '/test/workspace',
      type: 'hq',
      workspaceName: 'test-workspace',
      hasPMO: true,
      agents,
      repositories: [],
      agentsPath: '/test/workspace/agents/staff',
      activeThemeId: null,
      persistentAgentsDir: 'staff',
      ephemeralAgentsDir: 'temp',
    }
  }

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
    executionStorage = new ExecutionStorage(db)
  })

  afterEach(() => {
    fastDb.rollback()
  })

  after(() => {
    fastDb.close()
  })

  describe('getAvailableAgents', () => {
    it('returns only persistent agents with active status', () => {
      const agents = [
        createMockAgent({ name: 'staff-1', type: 'persistent', status: 'active' }),
        createMockAgent({ name: 'staff-2', type: 'persistent', status: 'active' }),
        createMockAgent({ name: 'temp-1', type: 'ephemeral', status: 'active' }),
        createMockAgent({ name: 'cleaned-1', type: 'persistent', status: 'cleaned' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.have.length(2)
      expect(available).to.include('staff-1')
      expect(available).to.include('staff-2')
      expect(available).to.not.include('temp-1')
      expect(available).to.not.include('cleaned-1')
    })

    it('excludes agents with running executions', () => {
      const agents = [
        createMockAgent({ name: 'available', type: 'persistent', status: 'active' }),
        createMockAgent({ name: 'busy', type: 'persistent', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      // Create a running execution for 'busy' agent
      const exec = executionStorage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'busy',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(exec.id, 'running')

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.have.length(1)
      expect(available).to.include('available')
      expect(available).to.not.include('busy')
    })

    it('excludes agents with starting executions', () => {
      const agents = [
        createMockAgent({ name: 'available', type: 'persistent', status: 'active' }),
        createMockAgent({ name: 'starting', type: 'persistent', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      // Create a starting execution (default status)
      executionStorage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'starting',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.have.length(1)
      expect(available).to.include('available')
      expect(available).to.not.include('starting')
    })

    it('includes agents with only completed executions', () => {
      const agents = [
        createMockAgent({ name: 'done-agent', type: 'persistent', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      // Create a completed execution
      const exec = executionStorage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'done-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(exec.id, 'completed')

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.have.length(1)
      expect(available).to.include('done-agent')
    })

    it('returns empty array when no staff agents exist', () => {
      const agents = [
        createMockAgent({ name: 'temp-1', type: 'ephemeral', status: 'active' }),
        createMockAgent({ name: 'temp-2', type: 'ephemeral', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.deep.equal([])
    })

    it('returns empty array when all staff agents are busy', () => {
      const agents = [
        createMockAgent({ name: 'staff-1', type: 'persistent', status: 'active' }),
        createMockAgent({ name: 'staff-2', type: 'persistent', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      // Both agents are busy
      const exec1 = executionStorage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'staff-1',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(exec1.id, 'running')

      const exec2 = executionStorage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'staff-2',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(exec2.id, 'running')

      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.deep.equal([])
    })

    it('cleans up stale executions before checking availability', () => {
      const agents = [
        createMockAgent({ name: 'stale-agent', type: 'persistent', status: 'active' }),
      ]
      const workspaceInfo = createMockWorkspaceInfo(agents)

      // Create an old stale execution (no sessionId, older than 5 minutes)
      const oldTime = Date.now() - 10 * 60 * 1000
      db.prepare(`
        INSERT INTO ${PMO_TABLES.agent_work} (
          id, ticket_id, agent_name, executor, environment, display_mode,
          permission_mode, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('WORK-STALE', 'TKT-001', 'stale-agent', 'claude', 'host', 'terminal', 'safe', 'running', oldTime)

      // Before getAvailableAgents, agent appears busy
      expect(executionStorage.isAgentAvailable('stale-agent')).to.be.false

      // getAvailableAgents should clean up and return the agent as available
      const available = getAvailableAgents(workspaceInfo, executionStorage)

      expect(available).to.have.length(1)
      expect(available).to.include('stale-agent')
    })
  })

  // ===========================================================================
  // PRLT-1119: resolveOutputMode — background display must use print mode
  // ===========================================================================
  describe('resolveOutputMode (PRLT-1119)', () => {
    it('returns print for background display mode', () => {
      expect(resolveOutputMode('background')).to.equal('print')
    })

    it('returns interactive for terminal display mode', () => {
      expect(resolveOutputMode('terminal')).to.equal('interactive')
    })

    it('returns interactive for foreground display mode', () => {
      expect(resolveOutputMode('foreground')).to.equal('interactive')
    })
  })

  describe('selectAgent', () => {
    it('returns null when no agents available', () => {
      const selected = selectAgent('round-robin', [], executionStorage)
      expect(selected).to.be.null
    })

    it('selects first agent with round-robin strategy', () => {
      const availableAgents = ['agent-a', 'agent-b', 'agent-c']
      const selected = selectAgent('round-robin', availableAgents, executionStorage)
      expect(selected).to.equal('agent-a')
    })

    it('cycles through agents with round-robin state', () => {
      const availableAgents = ['agent-a', 'agent-b', 'agent-c']
      const state = { lastIndex: -1 }

      const first = selectAgent('round-robin', availableAgents, executionStorage, state)
      expect(first).to.equal('agent-a')
      expect(state.lastIndex).to.equal(0)

      const second = selectAgent('round-robin', availableAgents, executionStorage, state)
      expect(second).to.equal('agent-b')
      expect(state.lastIndex).to.equal(1)

      const third = selectAgent('round-robin', availableAgents, executionStorage, state)
      expect(third).to.equal('agent-c')
      expect(state.lastIndex).to.equal(2)

      // Wraps around
      const fourth = selectAgent('round-robin', availableAgents, executionStorage, state)
      expect(fourth).to.equal('agent-a')
      expect(state.lastIndex).to.equal(0)
    })

    it('selects agent with fewest executions using least-busy strategy', () => {
      const availableAgents = ['busy-agent', 'new-agent']

      // Create some history for busy-agent
      const execA = executionStorage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'busy-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(execA.id, 'completed')

      const execB = executionStorage.createExecution({
        ticketId: 'TKT-002',
        agentName: 'busy-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      executionStorage.updateStatus(execB.id, 'completed')

      const selected = selectAgent('least-busy', availableAgents, executionStorage)
      expect(selected).to.equal('new-agent')
    })

    it('selects random agent with random strategy', () => {
      const availableAgents = ['agent-a', 'agent-b', 'agent-c']

      // Run multiple times to verify it returns valid agents
      for (let i = 0; i < 10; i++) {
        const selected = selectAgent('random', availableAgents, executionStorage)
        expect(availableAgents).to.include(selected)
      }
    })
  })
})
