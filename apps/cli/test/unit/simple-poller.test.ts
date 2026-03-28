import { expect } from 'chai'
import { SimplePoller } from '../../src/lib/orchestrate/simple-poller.js'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a mock DB where the prepare().all() results can be swapped
 * between poll cycles to simulate state changes.
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
      all: () => {
        if (sql.includes('pmo_tickets') && sql.includes('todo')) {
          return data.readyTickets
        }
        if (sql.includes('agent_work')) {
          return data.agents
        }
        return []
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
  // Set cwd to a non-existent dir so gh CLI will be treated as unavailable
  return new SimplePoller({
    db: db as any,
    log: log ?? (() => {}),
    cwd: '/nonexistent-test-dir',
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('SimplePoller', () => {
  // ===========================================================================
  // Baseline / Initialization
  // ===========================================================================

  describe('initialization', () => {
    it('should return no changes on first poll (baseline capture)', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-001', title: 'Test ticket' }],
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-001', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      const result = await poller.poll()

      expect(result.changes).to.have.length(0)
      expect(result.message).to.be.null
    })

    it('should return no changes when state has not changed between polls', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-001', title: 'Test ticket' }],
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-001', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll() // baseline
      const result = await poller.poll()

      expect(result.changes).to.have.length(0)
      expect(result.message).to.be.null
    })
  })

  // ===========================================================================
  // Ready Ticket Detection
  // ===========================================================================

  describe('ready ticket polling', () => {
    it('should detect newly ready tickets after baseline', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createPoller(db)

      await poller.poll() // baseline with no tickets

      // Ticket appears
      db._data.readyTickets = [{ id: 'TKT-010', title: 'New feature' }]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('board')
      expect(result.changes[0].summary).to.include('TKT-010')
      expect(result.changes[0].summary).to.include('New feature')
      expect(result.changes[0].summary).to.include('Ready')
      expect(result.message).to.not.be.null
      expect(result.message!).to.include('Board:')
    })

    it('should detect multiple new ready tickets', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createPoller(db)

      await poller.poll()

      db._data.readyTickets = [
        { id: 'TKT-011', title: 'Feature A' },
        { id: 'TKT-012', title: 'Feature B' },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(2)
      expect(result.changes.every(c => c.category === 'board')).to.be.true
    })

    it('should detect tickets leaving Ready state', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-020', title: 'Existing ticket' }],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.readyTickets = []
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('board')
      expect(result.changes[0].summary).to.include('TKT-020')
      expect(result.changes[0].summary).to.include('no longer in Ready')
    })

    it('should detect mixed arrivals and departures', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-030', title: 'Will leave' }],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.readyTickets = [{ id: 'TKT-031', title: 'Just arrived' }]
      const result = await poller.poll()

      expect(result.changes).to.have.length(2)
      const summaries = result.changes.map(c => c.summary)
      expect(summaries.some(s => s.includes('TKT-030') && s.includes('no longer'))).to.be.true
      expect(summaries.some(s => s.includes('TKT-031') && s.includes('Ready'))).to.be.true
    })

    it('should handle DB errors gracefully without throwing', async () => {
      const db = {
        _data: { readyTickets: [], agents: [] },
        prepare: () => { throw new Error('table does not exist') },
        close: () => {},
      }
      const poller = createPoller(db as any)

      const result = await poller.poll()
      expect(result.changes).to.have.length(0)
    })
  })

  // ===========================================================================
  // Agent Lifecycle Polling
  // ===========================================================================

  describe('agent lifecycle polling', () => {
    it('should detect agent completing', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-1', ticket_id: 'TKT-040', agent_name: 'bold-ada', status: 'completed', lifecycle_state: 'completed', container_id: null },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('agents')
      expect(result.changes[0].summary).to.include('bold-ada')
      expect(result.changes[0].summary).to.include('completed')
    })

    it('should detect agent dying/failing', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-2', ticket_id: 'TKT-041', agent_name: 'major-dario', status: 'running', lifecycle_state: null, container_id: 'abc123' },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-2', ticket_id: 'TKT-041', agent_name: 'major-dario', status: 'failed', lifecycle_state: 'died', container_id: 'abc123' },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('agents')
      expect(result.changes[0].summary).to.include('major-dario')
      expect(result.changes[0].summary).to.include('died')
    })

    it('should detect agent stopping', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-3', ticket_id: 'TKT-042', agent_name: 'shy-euler', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-3', ticket_id: 'TKT-042', agent_name: 'shy-euler', status: 'stopped', lifecycle_state: null, container_id: null },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('agents')
      expect(result.changes[0].summary).to.include('shy-euler')
      expect(result.changes[0].summary).to.include('stopped')
    })

    it('should detect agent becoming idle', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-4', ticket_id: 'TKT-043', agent_name: 'calm-turing', status: 'running', lifecycle_state: 'healthy', container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-4', ticket_id: 'TKT-043', agent_name: 'calm-turing', status: 'running', lifecycle_state: 'idle', container_id: null },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].category).to.equal('agents')
      expect(result.changes[0].summary).to.include('calm-turing')
      expect(result.changes[0].summary).to.include('idle')
    })

    it('should detect agent transitioning from starting to running', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-5', ticket_id: 'TKT-044', agent_name: 'quick-gauss', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-5', ticket_id: 'TKT-044', agent_name: 'quick-gauss', status: 'running', lifecycle_state: null, container_id: null },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].summary).to.include('quick-gauss')
      expect(result.changes[0].summary).to.include('now running')
    })

    it('should not fire for unchanged agent state', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-6', ticket_id: 'TKT-045', agent_name: 'stable-agent', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()
      const result = await poller.poll()

      expect(result.changes).to.have.length(0)
    })

    it('should detect status change via error status', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-7', ticket_id: 'TKT-046', agent_name: 'fragile-agent', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.agents = [
        { id: 'exec-7', ticket_id: 'TKT-046', agent_name: 'fragile-agent', status: 'error', lifecycle_state: null, container_id: null },
      ]
      const result = await poller.poll()

      expect(result.changes).to.have.length(1)
      expect(result.changes[0].summary).to.include('fragile-agent')
      expect(result.changes[0].summary).to.include('died')
    })
  })

  // ===========================================================================
  // Combined Changes & Message Format
  // ===========================================================================

  describe('poke message formatting', () => {
    it('should format message with board and agent sections', async () => {
      const db = createMockDb({
        readyTickets: [],
        agents: [
          { id: 'exec-m1', ticket_id: 'TKT-050', agent_name: 'multi-agent', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll()

      // Agent completes AND new ticket arrives
      db._data.agents = [
        { id: 'exec-m1', ticket_id: 'TKT-050', agent_name: 'multi-agent', status: 'completed', lifecycle_state: 'completed', container_id: null },
      ]
      db._data.readyTickets = [{ id: 'TKT-060', title: 'New ready ticket' }]

      const result = await poller.poll()

      expect(result.changes).to.have.length(2)
      expect(result.message).to.not.be.null
      expect(result.message!).to.include('Board:')
      expect(result.message!).to.include('Agents:')
      expect(result.message!).to.include('TKT-060')
      expect(result.message!).to.include('multi-agent')
    })

    it('should return null message when no changes detected', async () => {
      const db = createMockDb()
      const poller = createPoller(db)

      await poller.poll()
      const result = await poller.poll()

      expect(result.message).to.be.null
    })

    it('should list each change as a bullet point', async () => {
      const db = createMockDb({
        readyTickets: [],
      })
      const poller = createPoller(db)

      await poller.poll()

      db._data.readyTickets = [
        { id: 'TKT-070', title: 'First' },
        { id: 'TKT-071', title: 'Second' },
      ]
      const result = await poller.poll()

      expect(result.message).to.not.be.null
      const lines = result.message!.split('\n')
      const bullets = lines.filter(l => l.startsWith('- '))
      expect(bullets).to.have.length(2)
    })
  })

  // ===========================================================================
  // Multiple Poll Cycles
  // ===========================================================================

  describe('multi-cycle behavior', () => {
    it('should only report new changes in each cycle', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createPoller(db)

      await poller.poll() // baseline

      // Cycle 1: ticket appears
      db._data.readyTickets = [{ id: 'TKT-080', title: 'First wave' }]
      const r1 = await poller.poll()
      expect(r1.changes).to.have.length(1)

      // Cycle 2: same ticket still there — no new changes
      const r2 = await poller.poll()
      expect(r2.changes).to.have.length(0)
      expect(r2.message).to.be.null

      // Cycle 3: another ticket appears
      db._data.readyTickets = [
        { id: 'TKT-080', title: 'First wave' },
        { id: 'TKT-081', title: 'Second wave' },
      ]
      const r3 = await poller.poll()
      expect(r3.changes).to.have.length(1)
      expect(r3.changes[0].summary).to.include('TKT-081')
    })

    it('should track agent state transitions across cycles', async () => {
      const db = createMockDb({
        agents: [
          { id: 'exec-mc', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createPoller(db)

      await poller.poll() // baseline: starting

      // Cycle 1: starting → running
      db._data.agents = [
        { id: 'exec-mc', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'running', lifecycle_state: null, container_id: null },
      ]
      const r1 = await poller.poll()
      expect(r1.changes).to.have.length(1)
      expect(r1.changes[0].summary).to.include('now running')

      // Cycle 2: running → idle
      db._data.agents = [
        { id: 'exec-mc', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'running', lifecycle_state: 'idle', container_id: null },
      ]
      const r2 = await poller.poll()
      expect(r2.changes).to.have.length(1)
      expect(r2.changes[0].summary).to.include('idle')

      // Cycle 3: idle → completed
      db._data.agents = [
        { id: 'exec-mc', ticket_id: 'TKT-090', agent_name: 'lifecycle-agent', status: 'completed', lifecycle_state: 'completed', container_id: null },
      ]
      const r3 = await poller.poll()
      expect(r3.changes).to.have.length(1)
      expect(r3.changes[0].summary).to.include('completed')
    })
  })
})
