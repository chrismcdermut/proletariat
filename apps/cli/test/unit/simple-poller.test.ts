import { expect } from 'chai'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SimplePoller } from '../../src/lib/orchestrate/simple-poller.js'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a mock DB where the prepare().all() results can be configured
 * to return specific state for each poll cycle.
 */
function createMockDb(options?: {
  readyTickets?: Array<{ id: string; title: string }>
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
}) {
  const data = {
    readyTickets: options?.readyTickets ?? [],
    agents: (options?.agents ?? []).map(a => ({
      ...a,
      session_id: a.session_id ?? null,
      environment: a.environment ?? 'host',
    })),
  }

  return {
    _data: data,
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        // Match ready tickets query (by status name or unstarted category)
        if (sql.includes('pmo_tickets') && (sql.includes('ws.name') || sql.includes('unstarted'))) {
          return data.readyTickets
        }
        if (sql.includes('agent_work')) {
          return data.agents
        }
        return []
      },
      get: (..._args: unknown[]) => {
        // Handle pmo_settings lookups for getWorkflowConfig
        if (sql.includes('pmo_settings')) {
          return undefined // No config -> fallback to category-based query
        }
        return undefined
      },
    }),
    close: () => {},
  }
}

/**
 * Create a SimplePoller with GitHub CLI disabled (no external calls).
 * This lets us test DB-driven polling (agents + board) in isolation.
 */
function createPoller(db: ReturnType<typeof createMockDb>, log?: (msg: string) => void) {
  return new SimplePoller({
    db: db as any,
    log: log ?? (() => {}),
    cwd: '/nonexistent-test-dir',
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
        readyTickets: [{ id: 'TKT-001', title: 'Test ticket' }],
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-001', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

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
      expect(result.message).to.include('Ready tickets: none')
      expect(result.message).to.include('Active agents: none')
    })

    it('should reflect state changes immediately without needing a prior baseline', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createPoller(db)

      // First poll: nothing
      const r1 = await poller.poll()
      expect(r1.items).to.have.length(0)

      // Ticket appears — immediately reported, no baseline needed
      db._data.readyTickets = [{ id: 'TKT-010', title: 'New feature' }]
      const r2 = await poller.poll()
      expect(r2.items).to.have.length(1)
      expect(r2.items[0].summary).to.include('TKT-010')
      expect(r2.items[0].summary).to.include('New feature')
    })
  })

  // ===========================================================================
  // Ready Ticket State
  // ===========================================================================

  describe('ready ticket state', () => {
    it('should report all ready tickets', async () => {
      const db = createMockDb({
        readyTickets: [
          { id: 'TKT-011', title: 'Feature A' },
          { id: 'TKT-012', title: 'Feature B' },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const boardItems = result.items.filter(i => i.category === 'board')
      expect(boardItems).to.have.length(2)
      expect(boardItems[0].summary).to.include('TKT-011')
      expect(boardItems[0].summary).to.include('Feature A')
      expect(boardItems[0].summary).to.include('ready')
      expect(boardItems[0].summary).to.include('unassigned')
      expect(boardItems[1].summary).to.include('TKT-012')
    })

    it('should report no board items when no tickets are ready', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createPoller(db)

      const result = await poller.poll()

      const boardItems = result.items.filter(i => i.category === 'board')
      expect(boardItems).to.have.length(0)
    })

    it('should handle DB errors gracefully without throwing', async () => {
      const db = {
        _data: { readyTickets: [], agents: [] },
        prepare: () => { throw new Error('table does not exist') },
        close: () => {},
      }
      const poller = createPoller(db as any)

      const result = await poller.poll()
      expect(result.items).to.have.length(0)
    })

    it('should use category-based query, not status name match (PRLT-1350)', async () => {
      // Regression: gatherReadyTicketState() used config.planned (defaults to "Planned")
      // but the board status is named "Ready". The fix uses ws.category = 'unstarted'
      // which matches any ready-like status regardless of name.
      const queriesExecuted: string[] = []
      const db = {
        _data: { readyTickets: [{ id: 'TKT-R1', title: 'Ready ticket' }], agents: [] },
        prepare: (sql: string) => {
          queriesExecuted.push(sql)
          return {
            all: (..._args: unknown[]) => {
              if (sql.includes('pmo_tickets') && sql.includes('unstarted')) {
                return [{ id: 'TKT-R1', title: 'Ready ticket' }]
              }
              if (sql.includes('agent_work')) return []
              return []
            },
            get: () => undefined,
          }
        },
        close: () => {},
      }
      const poller = createPoller(db as any)

      const result = await poller.poll()

      // Must find the ticket via category-based query
      const boardItems = result.items.filter(i => i.category === 'board')
      expect(boardItems).to.have.length(1)
      expect(boardItems[0].summary).to.include('TKT-R1')

      // The ticket query must NOT use ws.name matching (the old broken approach)
      const ticketQuery = queriesExecuted.find(q => q.includes('pmo_tickets') && q.includes('unstarted'))
      expect(ticketQuery).to.exist
      // Should not have a ws.name = ? clause in the ticket query
      const nameMatchQuery = queriesExecuted.find(q => q.includes('pmo_tickets') && q.includes('ws.name'))
      expect(nameMatchQuery).to.be.undefined
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
        readyTickets: [{ id: 'TKT-060', title: 'New ready ticket' }],
        agents: [
          { id: 'exec-m1', ticket_id: 'TKT-050', agent_name: 'multi-agent', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.message).to.not.be.null
      expect(result.message!).to.include('Ready tickets')
      expect(result.message!).to.include('Active agents')
      expect(result.message!).to.include('TKT-060')
    })

    it('should include counts in section headers', async () => {
      const db = createMockDb({
        readyTickets: [
          { id: 'TKT-070', title: 'First' },
          { id: 'TKT-071', title: 'Second' },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.message).to.include('Ready tickets (2 unassigned):')
    })

    it('should show "none" sections when category is empty', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-001', title: 'Solo' }],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.message).to.include('GitHub PRs: none')
      expect(result.message).to.include('Active agents: none')
      expect(result.message).to.include('Ready tickets (1 unassigned):')
    })

    it('should list ticket items as bullet points', async () => {
      const db = createMockDb({
        readyTickets: [
          { id: 'TKT-070', title: 'First' },
          { id: 'TKT-071', title: 'Second' },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.message).to.not.be.null
      const lines = result.message!.split('\n')
      const bullets = lines.filter(l => l.startsWith('- '))
      expect(bullets).to.have.length(2)
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
  })

  // ===========================================================================
  // Combined State
  // ===========================================================================

  describe('combined state across categories', () => {
    it('should report agents and tickets together', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-080', title: 'Feature X' }],
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.items).to.have.length(2)
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
