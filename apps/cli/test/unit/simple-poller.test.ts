import { expect } from 'chai'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SimplePoller, type BoardTicketInfo } from '../../src/lib/orchestrate/simple-poller.js'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a mock DB for agent state queries.
 * Board tickets now come from the injected fetchBoardTickets, not from DB.
 */
function createMockDb(options?: {
  agents?: Array<{
    id: string
    ticket_id: string
    agent_name: string
    status: string
    lifecycle_state: string | null
    container_id: string | null
    session_id?: string | null
    environment?: string | null
  }>
  activeAgentTicketIds?: string[]
}) {
  const data = {
    agents: (options?.agents ?? []).map(a => ({
      ...a,
      session_id: a.session_id ?? null,
      environment: a.environment ?? 'host',
    })),
    activeAgentTicketIds: options?.activeAgentTicketIds ?? [],
  }

  return {
    _data: data,
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        // Active agent ticket_ids query (for ready ticket exclusion)
        if (sql.includes('agent_work') && sql.includes('ticket_id') && !sql.includes('agent_name')) {
          return data.activeAgentTicketIds.map(id => ({ ticket_id: id }))
        }
        if (sql.includes('agent_work')) {
          return data.agents
        }
        return []
      },
      get: (..._args: unknown[]) => {
        // Handle pmo_settings lookups for getWorkflowConfig
        if (sql.includes('pmo_settings')) {
          return undefined // No config -> use default ready status names
        }
        return undefined
      },
    }),
    close: () => {},
  }
}

/**
 * Create a fetchBoardTickets mock that returns the given tickets.
 */
function mockFetchBoardTickets(
  tickets: BoardTicketInfo[],
): () => Promise<BoardTicketInfo[]> {
  return async () => tickets
}

/**
 * Create a fetchReadyTickets mock that returns the given tickets.
 * @deprecated Use mockFetchBoardTickets for new tests.
 */
function mockFetchReadyTickets(
  tickets: Array<{ id: string; title: string }>,
): (readyNames: Set<string>) => Promise<Array<{ id: string; title: string }>> {
  return async (_readyNames: Set<string>) => tickets
}

/**
 * Helper: build a BoardTicketInfo for a ready/unassigned ticket.
 */
function readyTicket(id: string, title: string): BoardTicketInfo {
  return { id, title, statusName: 'Ready', statusCategory: 'unstarted' }
}

/**
 * Create a SimplePoller with GitHub CLI disabled (no external calls).
 * Uses fetchBoardTickets for full board state testing.
 */
function createPoller(
  db: ReturnType<typeof createMockDb>,
  boardTickets?: BoardTicketInfo[],
  log?: (msg: string) => void,
) {
  return new SimplePoller({
    db: db as any,
    log: log ?? (() => {}),
    cwd: '/nonexistent-test-dir',
    fetchBoardTickets: mockFetchBoardTickets(boardTickets ?? []),
  })
}

/**
 * Create a temp directory with git init for repo discovery tests.
 * Returns the directory path. Caller must clean up.
 */
function createTempGitRepo(name: string): string {
  const dir = path.join(os.tmpdir(), `prlt-test-${name}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
  return dir
}

/**
 * Create a temp HQ-like workspace with repos/ subdirectory.
 * Returns the workspace root path. Caller must clean up.
 */
function createTempHQWorkspace(repoNames: string[]): string {
  const wsRoot = path.join(os.tmpdir(), `prlt-test-hq-${Date.now()}`)
  const reposDir = path.join(wsRoot, 'repos')
  fs.mkdirSync(reposDir, { recursive: true })

  for (const name of repoNames) {
    const repoDir = path.join(reposDir, name)
    fs.mkdirSync(repoDir, { recursive: true })
    execSync('git init', { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] })
  }

  return wsRoot
}

// =============================================================================
// Tests
// =============================================================================

describe('SimplePoller', () => {
  // ===========================================================================
  // Stateless State Reporting (PRLT-1346 design change)
  // ===========================================================================

  describe('stateless state reporting', () => {
    it('should return full state on every poll — no baseline, no diffing', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-001', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db, [readyTicket('TKT-001', 'Test ticket')])

      // First poll returns full state (not empty like the old baseline behavior)
      const r1 = await poller.poll()
      expect(r1.items.length).to.be.greaterThan(0)
      expect(r1.message).to.not.be.null

      // Second poll returns the same state — no diff, just full report
      const r2 = await poller.poll()
      expect(r2.items).to.deep.equal(r1.items)
      expect(r2.message).to.equal(r1.message)
    })

    it('should return a formatted message even when there is no state', async () => {
      const db = createMockDb()
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.items).to.have.length(0)
      // Always returns a full state report — no null messages (PRLT-1347)
      expect(result.message).to.be.a('string')
      expect(result.message).to.include('GitHub PRs: none')
      expect(result.message).to.include('Board: no active tickets')
      expect(result.message).to.include('Active agents: none')
    })

    it('should reflect state changes immediately without needing a prior baseline', async () => {
      let currentTickets: BoardTicketInfo[] = []
      const db = createMockDb()
      const poller = new SimplePoller({
        db: db as any,
        log: () => {},
        cwd: '/nonexistent-test-dir',
        fetchBoardTickets: async () => currentTickets,
      })

      // First poll: nothing
      const r1 = await poller.poll()
      expect(r1.items.filter(i => i.category === 'board')).to.have.length(0)

      // Ticket appears — immediately reported, no baseline needed
      currentTickets = [readyTicket('TKT-010', 'New feature')]
      const r2 = await poller.poll()
      const boardItems = r2.items.filter(i => i.category === 'board')
      // Column summary + individual ready ticket
      expect(boardItems.length).to.be.greaterThanOrEqual(1)
      expect(boardItems.some(i => i.summary.includes('TKT-010'))).to.be.true
      expect(boardItems.some(i => i.summary.includes('New feature'))).to.be.true
    })
  })

  // ===========================================================================
  // Full Board State (PRLT-1358: all columns, not just ready)
  // ===========================================================================

  describe('full board state (PRLT-1358)', () => {
    it('should report ticket counts by column', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'A', statusName: 'Backlog', statusCategory: 'backlog' },
        { id: 'TKT-002', title: 'B', statusName: 'Ready', statusCategory: 'unstarted' },
        { id: 'TKT-003', title: 'C', statusName: 'Ready', statusCategory: 'unstarted' },
        { id: 'TKT-004', title: 'D', statusName: 'In Progress', statusCategory: 'started' },
        { id: 'TKT-005', title: 'E', statusName: 'Review', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Board state:')
      expect(result.message).to.include('Backlog: 1')
      expect(result.message).to.include('Ready: 2')
      expect(result.message).to.include('In Progress: 1')
      expect(result.message).to.include('Review: 1')
    })

    it('should exclude completed and canceled tickets from board state counts', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Active', statusName: 'In Progress', statusCategory: 'started' },
        { id: 'TKT-002', title: 'Done', statusName: 'Done', statusCategory: 'completed' },
        { id: 'TKT-003', title: 'Dropped', statusName: 'Canceled', statusCategory: 'canceled' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('In Progress: 1')
      expect(result.message).to.not.include('Done:')
      expect(result.message).to.not.include('Canceled:')
    })

    it('should still list ready/unassigned tickets individually for orchestrator', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Ready A', statusName: 'Ready', statusCategory: 'unstarted' },
        { id: 'TKT-002', title: 'Ready B', statusName: 'Todo', statusCategory: 'unstarted' },
        { id: 'TKT-003', title: 'In Prog', statusName: 'In Progress', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      // Individual ready tickets listed
      expect(result.message).to.include('Ready tickets (2 unassigned):')
      expect(result.message).to.include('TKT-001 "Ready A": ready, unassigned')
      expect(result.message).to.include('TKT-002 "Ready B": ready, unassigned')
      // In Progress ticket NOT listed as ready
      expect(result.message).to.not.include('TKT-003 "In Prog": ready')
    })

    it('should not list assigned tickets as ready even if in ready status', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Free', statusName: 'Ready', statusCategory: 'unstarted' },
        { id: 'TKT-002', title: 'Taken', statusName: 'Ready', statusCategory: 'unstarted', assignee: 'agent-1' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Ready tickets (1 unassigned):')
      expect(result.message).to.include('TKT-001 "Free": ready, unassigned')
      expect(result.message).to.not.include('TKT-002')
    })

    it('should show "Board: no active tickets" when all tickets are terminal', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Done', statusName: 'Done', statusCategory: 'completed' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Board: no active tickets')
    })

    it('should handle fetchBoardTickets errors gracefully without throwing', async () => {
      const db = createMockDb()
      const poller = new SimplePoller({
        db: db as any,
        log: () => {},
        cwd: '/nonexistent-test-dir',
        fetchBoardTickets: async () => { throw new Error('provider unavailable') },
      })

      const result = await poller.poll()
      expect(result.items.filter(i => i.category === 'board')).to.have.length(0)
    })
  })

  // ===========================================================================
  // Board Anomaly Detection (PRLT-1358)
  // ===========================================================================

  describe('board anomaly detection (PRLT-1358)', () => {
    it('should flag tickets in progress with no active agent', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Stuck ticket', statusName: 'In Progress', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      expect(anomalies).to.have.length.greaterThanOrEqual(1)
      expect(anomalies.some(a => a.summary.includes('TKT-001') && a.summary.includes('no active agent'))).to.be.true
    })

    it('should not flag in-progress tickets that have an active agent', async () => {
      const db = createMockDb({
        activeAgentTicketIds: ['TKT-001'],
      })
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Working ticket', statusName: 'In Progress', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      expect(anomalies.every(a => !a.summary.includes('no active agent'))).to.be.true
    })

    it('should flag tickets in review with no open PR', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Review orphan', statusName: 'Review', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      expect(anomalies.some(a => a.summary.includes('TKT-001') && a.summary.includes('no open PR'))).to.be.true
    })

    it('should flag tickets stuck in a column for >24h', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      const db = createMockDb({
        activeAgentTicketIds: ['TKT-001'],
      })
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Stale ticket', statusName: 'In Progress', statusCategory: 'started', updatedAt: twoDaysAgo },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      expect(anomalies.some(a => a.summary.includes('TKT-001') && a.summary.includes('stuck in In Progress for 2d'))).to.be.true
    })

    it('should not flag stale tickets in backlog or triage', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Old backlog', statusName: 'Backlog', statusCategory: 'backlog', updatedAt: twoDaysAgo },
        { id: 'TKT-002', title: 'Old triage', statusName: 'Triage', statusCategory: 'triage', updatedAt: twoDaysAgo },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      const stuckAnomalies = anomalies.filter(a => a.summary.includes('stuck'))
      expect(stuckAnomalies).to.have.length(0)
    })

    it('should not flag recently updated started tickets as stuck', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const db = createMockDb({
        activeAgentTicketIds: ['TKT-001'],
      })
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Fresh ticket', statusName: 'In Progress', statusCategory: 'started', updatedAt: oneHourAgo },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      const stuckAnomalies = anomalies.filter(a => a.summary.includes('stuck'))
      expect(stuckAnomalies).to.have.length(0)
    })

    it('should format anomalies section in output message', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Orphan', statusName: 'In Progress', statusCategory: 'started' },
        { id: 'TKT-002', title: 'No PR', statusName: 'Review', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Anomalies (')
      expect(result.message).to.include('- TKT-001 "Orphan": in progress with no active agent')
      expect(result.message).to.include('- TKT-002 "No PR": in review with no open PR')
    })

    it('should not show anomalies section when there are none', async () => {
      const db = createMockDb({
        activeAgentTicketIds: ['TKT-001'],
      })
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'Healthy', statusName: 'Ready', statusCategory: 'unstarted' },
      ])

      const result = await poller.poll()

      expect(result.message).to.not.include('Anomalies')
    })

    it('should detect anomalies via statusCategory for non-standard status names', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        // Non-standard status name but category is 'started'
        { id: 'TKT-001', title: 'Custom status', statusName: 'Doing Stuff', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      const anomalies = result.items.filter(i => i.category === 'anomaly')
      expect(anomalies.some(a => a.summary.includes('TKT-001') && a.summary.includes('no active agent'))).to.be.true
    })
  })

  // ===========================================================================
  // Ready Ticket State — backward compat (PRLT-1354 via fetchReadyTickets)
  // ===========================================================================

  describe('ready ticket state (legacy fetchReadyTickets)', () => {
    it('should still work with fetchReadyTickets for backward compatibility', async () => {
      const db = createMockDb()
      const poller = new SimplePoller({
        db: db as any,
        log: () => {},
        cwd: '/nonexistent-test-dir',
        fetchReadyTickets: mockFetchReadyTickets([
          { id: 'TKT-011', title: 'Feature A' },
          { id: 'TKT-012', title: 'Feature B' },
        ]),
      })

      const result = await poller.poll()

      const boardItems = result.items.filter(i => i.category === 'board')
      // Should include column summary + individual ready tickets
      expect(boardItems.some(i => i.summary.includes('TKT-011'))).to.be.true
      expect(boardItems.some(i => i.summary.includes('Feature A'))).to.be.true
      expect(boardItems.some(i => i.summary.includes('ready'))).to.be.true
    })

    it('should exclude tickets with active agents via legacy path', async () => {
      const db = createMockDb({
        activeAgentTicketIds: ['TKT-ACTIVE'],
      })
      const poller = new SimplePoller({
        db: db as any,
        log: () => {},
        cwd: '/nonexistent-test-dir',
        fetchReadyTickets: mockFetchReadyTickets([
          { id: 'TKT-ACTIVE', title: 'Has running agent' },
          { id: 'TKT-FREE', title: 'No agent' },
        ]),
      })

      const result = await poller.poll()

      const readyItems = result.items.filter(i => i.category === 'board' && i.summary.includes('ready, unassigned'))
      expect(readyItems).to.have.length(1)
      expect(readyItems[0].summary).to.include('TKT-FREE')
    })

    it('should use live provider, not stale ticket_refs.status (PRLT-1354 regression)', async () => {
      let providerCalled = false
      const db = createMockDb()
      const poller = new SimplePoller({
        db: db as any,
        log: () => {},
        cwd: '/nonexistent-test-dir',
        fetchReadyTickets: async (readyNames: Set<string>) => {
          providerCalled = true
          expect(readyNames).to.include('ready')
          expect(readyNames).to.include('todo')
          expect(readyNames).to.include('planned')
          return [{ id: 'PRLT-1236', title: 'Ready ticket from provider' }]
        },
      })

      const result = await poller.poll()

      expect(providerCalled).to.be.true
      const boardItems = result.items.filter(i => i.category === 'board')
      expect(boardItems.some(i => i.summary.includes('PRLT-1236'))).to.be.true
    })
  })

  // ===========================================================================
  // Agent State (PRLT-1348: health-based detection)
  // ===========================================================================

  describe('agent state', () => {
    it('should report running agents with health state from tmux detection', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(1)
      expect(agentItems[0].summary).to.include('bold-ada')
      expect(agentItems[0].summary).to.include('TKT-040')
      // Without tmux sessions available in test, running agents show as UNKNOWN
      expect(agentItems[0].healthState).to.equal('UNKNOWN')
    })

    it('should set healthState on each agent item', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems[0]).to.have.property('healthState')
      expect(['WORKING', 'IDLE', 'HUNG', 'DONE', 'UNKNOWN']).to.include(agentItems[0].healthState)
    })

    it('should report completed agents as DONE', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(1)
      expect(agentItems[0].healthState).to.equal('DONE')
      expect(agentItems[0].summary).to.include('DONE')
    })

    it('should report failed/error agents as IDLE (terminal state)', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'fragile-agent', status: 'error', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(1)
      expect(agentItems[0].summary).to.include('fragile-agent')
      expect(agentItems[0].healthState).to.equal('IDLE')
    })

    it('should report stopped agents as IDLE', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'stopped-agent', status: 'stopped', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems[0].healthState).to.equal('IDLE')
    })

    it('should report multiple agents with individual health states', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'agent-a', status: 'running', lifecycle_state: null, container_id: null },
          { id: 'exec-2', ticket_id: 'TKT-041', agent_name: 'agent-b', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(2)
      // First is running (no tmux -> UNKNOWN), second is completed (DONE)
      expect(agentItems[0].healthState).to.equal('UNKNOWN')
      expect(agentItems[1].healthState).to.equal('DONE')
    })
  })

  // ===========================================================================
  // Message Format (PRLT-1348: summary counts instead of full listing)
  // ===========================================================================

  describe('state message formatting', () => {
    it('should format agent section with summary counts instead of listing all', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-050', agent_name: 'agent-a', status: 'completed', lifecycle_state: 'completed', container_id: null },
          { id: 'exec-2', ticket_id: 'TKT-051', agent_name: 'agent-b', status: 'completed', lifecycle_state: 'completed', container_id: null },
          { id: 'exec-3', ticket_id: 'TKT-052', agent_name: 'agent-c', status: 'error', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      // Should show summary counts, not individual bullet points for each
      expect(result.message).to.include('Active agents (3):')
      expect(result.message).to.include('2 done')
      expect(result.message).to.include('1 idle')
    })

    it('should format message with section headers', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-m1', ticket_id: 'TKT-050', agent_name: 'multi-agent', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createPoller(db, [readyTicket('TKT-060', 'New ready ticket')])

      const result = await poller.poll()

      expect(result.message).to.not.be.null
      expect(result.message!).to.include('Ready tickets')
      expect(result.message!).to.include('Active agents')
      expect(result.message!).to.include('TKT-060')
    })

    it('should include counts in section headers', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        readyTicket('TKT-070', 'First'),
        readyTicket('TKT-071', 'Second'),
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Ready tickets (2 unassigned):')
    })

    it('should show "none" sections when category is empty', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [readyTicket('TKT-001', 'Solo')])

      const result = await poller.poll()

      expect(result.message).to.include('GitHub PRs: none')
      expect(result.message).to.include('Active agents: none')
      expect(result.message).to.include('Ready tickets (1 unassigned):')
    })

    it('should list ticket items as bullet points', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        readyTicket('TKT-070', 'First'),
        readyTicket('TKT-071', 'Second'),
      ])

      const result = await poller.poll()

      expect(result.message).to.not.be.null
      const lines = result.message!.split('\n')
      const readyBullets = lines.filter(l => l.startsWith('- ') && l.includes('ready, unassigned'))
      expect(readyBullets).to.have.length(2)
    })

    it('should not list idle/done/unknown agents as bullet points (PRLT-1348)', async () => {
      // The ticket: "Watch daemon should summarize: '3 working, 47 idle' not list all 50"
      const db = createMockDb({
        agents: Array.from({ length: 10 }, (_, i) => ({
          id: `exec-${i}`,
          ticket_id: `TKT-${100 + i}`,
          agent_name: `agent-${i}`,
          status: 'completed',
          lifecycle_state: 'completed',
          container_id: null,
        })),
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      // Summary line should be present
      expect(result.message).to.include('Active agents (10):')
      expect(result.message).to.include('10 done')
      // No individual agent bullet points for done agents
      const lines = result.message!.split('\n')
      const agentBullets = lines.filter(l => l.startsWith('- ') && l.includes('agent-'))
      expect(agentBullets).to.have.length(0)
    })

    it('should include board state summary in message (PRLT-1358)', async () => {
      const db = createMockDb()
      const poller = createPoller(db, [
        { id: 'TKT-001', title: 'A', statusName: 'Backlog', statusCategory: 'backlog' },
        { id: 'TKT-002', title: 'B', statusName: 'In Progress', statusCategory: 'started' },
        { id: 'TKT-003', title: 'C', statusName: 'In Progress', statusCategory: 'started' },
      ])

      const result = await poller.poll()

      expect(result.message).to.include('Board state:')
      expect(result.message).to.include('Backlog: 1')
      expect(result.message).to.include('In Progress: 2')
    })
  })

  // ===========================================================================
  // Combined State
  // ===========================================================================

  describe('combined state across categories', () => {
    it('should report agents and tickets together', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db, [readyTicket('TKT-080', 'Feature X')])

      const result = await poller.poll()

      // Column summary + ready ticket + agent = at least 3 items
      expect(result.items.length).to.be.greaterThanOrEqual(2)
      expect(result.items.some(i => i.category === 'board')).to.be.true
      expect(result.items.some(i => i.category === 'agents')).to.be.true
    })

    it('should reflect state changes in subsequent polls', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      // Poll 1: starting (no tmux -> UNKNOWN)
      const r1 = await poller.poll()
      const a1 = r1.items.find(i => i.category === 'agents')!
      expect(a1.healthState).to.equal('UNKNOWN')

      // Poll 2: completed -> DONE
      db._data.agents = [
        { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'completed', lifecycle_state: 'completed', container_id: null, session_id: null, environment: 'host' },
      ]
      const r2 = await poller.poll()
      const a2 = r2.items.find(i => i.category === 'agents')!
      expect(a2.healthState).to.equal('DONE')
    })
  })

  // ===========================================================================
  // PR Summary Format (PRLT-1353)
  // ===========================================================================

  describe('formatPRSummary', () => {
    it('should include repo name in PR label', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'proletariat',
        prNumber: 1224,
        title: 'fix ready ticket query',
        ticketId: 'PRLT-1350',
        ciState: 'success',
        mergeable: 'MERGEABLE',
        reviewDecision: null,
      })

      expect(summary).to.include('proletariat#1224')
    })

    it('should include ticket ID in parentheses when linked', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'proletariat',
        prNumber: 1224,
        title: 'fix ready ticket query',
        ticketId: 'PRLT-1350',
        ciState: 'success',
        mergeable: 'MERGEABLE',
        reviewDecision: null,
      })

      expect(summary).to.include('proletariat#1224 (PRLT-1350)')
      expect(summary).to.not.include('no linked ticket')
    })

    it('should show "no linked ticket" when no ticket ID', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'proletariat-marketing',
        prNumber: 16,
        title: 'Add security sandboxing',
        ciState: 'pending',
        mergeable: 'UNKNOWN',
        reviewDecision: null,
      })

      expect(summary).to.include('proletariat-marketing#16')
      expect(summary).to.include('no linked ticket')
      expect(summary).to.not.include('(')
    })

    it('should format title without quotes', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'my-repo',
        prNumber: 42,
        title: 'Add new feature',
        ticketId: 'TKT-001',
        ciState: 'unknown',
        mergeable: 'UNKNOWN',
        reviewDecision: null,
      })

      expect(summary).to.include(': Add new feature')
      expect(summary).to.not.include('"Add new feature"')
    })

    it('should include CI state', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'repo',
        prNumber: 1,
        title: 'test',
        ticketId: 'TKT-001',
        ciState: 'failure',
        mergeable: 'UNKNOWN',
        reviewDecision: null,
      })

      expect(summary).to.include('CI: failure')
    })

    it('should show merge conflicts when CONFLICTING', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'repo',
        prNumber: 1,
        title: 'test',
        ticketId: 'TKT-001',
        ciState: 'success',
        mergeable: 'CONFLICTING',
        reviewDecision: null,
      })

      expect(summary).to.include('has merge conflicts')
    })

    it('should show review decision when present', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'repo',
        prNumber: 1,
        title: 'test',
        ticketId: 'TKT-001',
        ciState: 'success',
        mergeable: 'MERGEABLE',
        reviewDecision: 'APPROVED',
      })

      expect(summary).to.include('review: APPROVED')
      expect(summary).to.not.include('no review')
    })

    it('should produce full expected format: repo#N (TICKET): title — CI — mergeable — review', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'proletariat',
        prNumber: 1224,
        title: 'fix watch daemon pollers',
        ticketId: 'PRLT-1350',
        ciState: 'success',
        mergeable: 'MERGEABLE',
        reviewDecision: 'APPROVED',
      })

      expect(summary).to.equal(
        'proletariat#1224 (PRLT-1350): fix watch daemon pollers — CI: success — mergeable — review: APPROVED',
      )
    })

    it('should produce full expected format for unlinked PR', () => {
      const summary = SimplePoller.formatPRSummary({
        repoName: 'proletariat-marketing',
        prNumber: 16,
        title: 'Add security sandboxing',
        ciState: 'pending',
        mergeable: 'UNKNOWN',
        reviewDecision: null,
      })

      expect(summary).to.equal(
        'proletariat-marketing#16: Add security sandboxing — no linked ticket — CI: pending — no review',
      )
    })
  })

  // ===========================================================================
  // Repo Directory Resolution (PRLT-1313 fix)
  // ===========================================================================

  describe('resolveRepoDirs', () => {
    it('should return empty array when cwd is undefined', () => {
      const dirs = SimplePoller.resolveRepoDirs(undefined)
      expect(dirs).to.deep.equal([])
    })

    it('should return [cwd] when cwd is a git repo', () => {
      const repoDir = createTempGitRepo('single-repo')
      try {
        const dirs = SimplePoller.resolveRepoDirs(repoDir)
        expect(dirs).to.have.length(1)
        expect(dirs[0]).to.equal(repoDir)
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
    })

    it('should discover repos in repos/ subdirectory for HQ workspace', () => {
      const wsRoot = createTempHQWorkspace(['repo-a', 'repo-b'])
      try {
        const dirs = SimplePoller.resolveRepoDirs(wsRoot)
        expect(dirs).to.have.length(2)
        expect(dirs.map(d => path.basename(d)).sort()).to.deep.equal(['repo-a', 'repo-b'])
      } finally {
        fs.rmSync(wsRoot, { recursive: true, force: true })
      }
    })

    it('should skip non-git directories in repos/', () => {
      const wsRoot = createTempHQWorkspace(['git-repo'])
      // Add a non-git directory alongside the git repo
      fs.mkdirSync(path.join(wsRoot, 'repos', 'not-a-repo'), { recursive: true })
      try {
        const dirs = SimplePoller.resolveRepoDirs(wsRoot)
        expect(dirs).to.have.length(1)
        expect(path.basename(dirs[0])).to.equal('git-repo')
      } finally {
        fs.rmSync(wsRoot, { recursive: true, force: true })
      }
    })

    it('should return empty array for non-git dir without repos/', () => {
      const tmpDir = path.join(os.tmpdir(), `prlt-test-norepo-${Date.now()}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      try {
        const logs: string[] = []
        const dirs = SimplePoller.resolveRepoDirs(tmpDir, (msg) => logs.push(msg))
        expect(dirs).to.deep.equal([])
        expect(logs.some(l => l.includes('Warning'))).to.be.true
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('should return empty array for non-existent path', () => {
      const dirs = SimplePoller.resolveRepoDirs('/nonexistent-test-dir-12345')
      expect(dirs).to.deep.equal([])
    })

    it('should log discovery count for HQ workspace', () => {
      const wsRoot = createTempHQWorkspace(['alpha', 'beta', 'gamma'])
      try {
        const logs: string[] = []
        const dirs = SimplePoller.resolveRepoDirs(wsRoot, (msg) => logs.push(msg))
        expect(dirs).to.have.length(3)
        expect(logs.some(l => l.includes('3 repo(s)'))).to.be.true
      } finally {
        fs.rmSync(wsRoot, { recursive: true, force: true })
      }
    })
  })
})
