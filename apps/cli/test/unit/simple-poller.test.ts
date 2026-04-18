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
  }>
}) {
  const data = {
    readyTickets: options?.readyTickets ?? [],
    agents: options?.agents ?? [],
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

    it('should return null message when there is no state at all', async () => {
      const db = createMockDb()
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.items).to.have.length(0)
      expect(result.message).to.be.null
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
  })

  // ===========================================================================
  // Agent State
  // ===========================================================================

  describe('agent state', () => {
    it('should report running agents with effective state', async () => {
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
      expect(agentItems[0].summary).to.include('running')
    })

    it('should use lifecycle_state when available', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'running', lifecycle_state: 'idle', container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems[0].summary).to.include('idle')
    })

    it('should report completed agents', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(1)
      expect(agentItems[0].summary).to.include('completed')
    })

    it('should report failed/error agents', async () => {
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
      expect(agentItems[0].summary).to.include('error')
    })

    it('should report multiple agents', async () => {
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
    })
  })

  // ===========================================================================
  // Message Format
  // ===========================================================================

  describe('state message formatting', () => {
    it('should format message with section headers and bullet points', async () => {
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
      expect(result.message!).to.include('multi-agent')
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

    it('should list each item as a bullet point', async () => {
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

      // Poll 1: starting
      const r1 = await poller.poll()
      expect(r1.items.find(i => i.category === 'agents')!.summary).to.include('starting')

      // Poll 2: running
      db._data.agents = [
        { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'running', lifecycle_state: null, container_id: null },
      ]
      const r2 = await poller.poll()
      expect(r2.items.find(i => i.category === 'agents')!.summary).to.include('running')

      // Poll 3: completed
      db._data.agents = [
        { id: 'exec-1', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'completed', lifecycle_state: 'completed', container_id: null },
      ]
      const r3 = await poller.poll()
      expect(r3.items.find(i => i.category === 'agents')!.summary).to.include('completed')
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
