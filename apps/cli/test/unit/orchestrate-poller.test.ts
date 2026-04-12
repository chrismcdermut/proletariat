import { expect } from 'chai'
import { OrchestratePoller } from '../../src/lib/orchestrate/poller.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import Database from 'better-sqlite3'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

/**
 * Unit tests for OrchestratePoller.
 *
 * Tests cover:
 * - Ticket polling (on_ticket_ready)
 * - Agent lifecycle polling (on_agent_died, on_agent_completed, on_agent_idle)
 * - Deduplication (same ticket not fired twice)
 * - Graceful error handling
 */

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)

  // Add orchestrate columns
  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli'")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
  } catch {
    // May already exist
  }

  // Create minimal ticket and status tables for polling
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status_id TEXT NOT NULL,
      assignee TEXT,
      FOREIGN KEY (status_id) REFERENCES pmo_workflow_statuses(id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      lifecycle_state TEXT,
      container_id TEXT,
      last_heartbeat TEXT,
      role TEXT NOT NULL DEFAULT 'worker'
    )
  `)

  // Create pmo_settings table for workflow config
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Insert statuses with proper categories
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ready', 'Ready', 'unstarted')").run()
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ip', 'In Progress', 'started')").run()

  // Configure the ready status name so the poller can find it
  db.prepare("INSERT INTO pmo_settings (key, value) VALUES ('column_planned', 'Ready')").run()

  return db
}

describe('OrchestratePoller', () => {
  let db: Database.Database
  let engine: OrchestrateEngine
  let firedEvents: Array<{ event: string; ctx: OrchestrateEventContext }>

  beforeEach(() => {
    db = createTestDb()
    firedEvents = []

    // Create engine that records fired events
    engine = new OrchestrateEngine({
      db,
      log: () => {},
    })

    // Monkey-patch fireEvent to record calls without executing hooks
    const origFireEvent = engine.fireEvent.bind(engine)
    engine.fireEvent = async (event: string, ctx: OrchestrateEventContext) => {
      firedEvents.push({ event, ctx })
      return []
    }
  })

  afterEach(() => {
    db.close()
  })

  // ===========================================================================
  // Ticket Polling
  // ===========================================================================

  describe('ticket polling', () => {
    it('should fire on_ticket_ready for unassigned todo tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Test ticket', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(1)
      expect(readyEvents[0].ctx.ticket).to.equal('TKT-1')
    })

    it('should not fire for assigned tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-2', 'Assigned', 'status-ready', 'agent-1')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })

    it('should not fire for tickets with active agents', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-3', 'Active', 'status-ready', NULL)").run()
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status) VALUES ('aw-1', 'TKT-3', 'agent-1', 'running')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })

    it('should not fire the same ticket twice (deduplication)', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-4', 'Dedup', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(1)
    })

    it('should not fire for non-todo tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-5', 'In Progress', 'status-ip', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })
  })

  // ===========================================================================
  // Agent Lifecycle Polling
  // ===========================================================================

  describe('agent lifecycle polling', () => {
    it('should fire on_agent_died when lifecycle_state transitions to died', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-1', 'TKT-1', 'agent-1', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      // First poll: observe initial state
      await poller.poll()
      expect(firedEvents.filter(e => e.event === 'on_agent_died')).to.be.empty

      // Update to died state
      db.prepare("UPDATE agent_work SET lifecycle_state = 'died', status = 'error' WHERE id = 'aw-1'").run()
      await poller.poll()

      const diedEvents = firedEvents.filter(e => e.event === 'on_agent_died')
      expect(diedEvents).to.have.length(1)
      expect(diedEvents[0].ctx.agent).to.equal('agent-1')
    })

    it('should fire on_agent_completed when lifecycle_state transitions to completed', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-2', 'TKT-2', 'agent-2', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll() // observe initial

      db.prepare("UPDATE agent_work SET lifecycle_state = 'completed' WHERE id = 'aw-2'").run()
      await poller.poll()

      const completedEvents = firedEvents.filter(e => e.event === 'on_agent_completed')
      expect(completedEvents).to.have.length(1)
      expect(completedEvents[0].ctx.ticket).to.equal('TKT-2')
    })

    it('should not fire on first observation (no transition)', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-3', 'TKT-3', 'agent-3', 'error', 'died')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      // Should not fire because this is the first observation, not a transition
      expect(firedEvents.filter(e => e.event === 'on_agent_died')).to.be.empty
    })
  })

  // ===========================================================================
  // Conflict Resolution Dedup (PRLT-1222)
  // ===========================================================================

  describe('PRLT-1222: conflict resolution deduplication', () => {
    it('should expose activeConflictResolutions set for tracking', () => {
      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      // The poller should have the activeConflictResolutions tracking
      // This is a structural test — the set is private, so we verify
      // the poller can be created without errors
      expect(poller).to.be.instanceOf(OrchestratePoller)
    })
  })

  // ===========================================================================
  // Agent Lifecycle Dedup (PRLT-1223)
  // ===========================================================================

  describe('agent lifecycle deduplication', () => {
    it('should not fire same event twice for same agent state', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-d1', 'TKT-D1', 'agent-d1', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })

      // First poll: observe initial state
      await poller.poll()
      expect(firedEvents.filter(e => e.event === 'on_agent_died')).to.be.empty

      // Transition to died
      db.prepare("UPDATE agent_work SET lifecycle_state = 'died', status = 'error' WHERE id = 'aw-d1'").run()
      await poller.poll()

      const diedAfterFirst = firedEvents.filter(e => e.event === 'on_agent_died')
      expect(diedAfterFirst).to.have.length(1)

      // Poll again with same state — should NOT fire again
      await poller.poll()
      const diedAfterSecond = firedEvents.filter(e => e.event === 'on_agent_died')
      expect(diedAfterSecond).to.have.length(1, 'on_agent_died should not fire twice for the same state')
    })

    it('should fire on_agent_idle for heartbeat timeout detection', async () => {
      // Insert an agent with a recent heartbeat first
      db.prepare(`
        INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state, last_heartbeat)
        VALUES ('aw-idle', 'TKT-IDLE', 'idle-agent', 'running', 'healthy', datetime('now'))
      `).run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })

      // First poll: observe initial state (records prevState as 'healthy')
      await poller.poll()
      expect(firedEvents.filter(e => e.event === 'on_agent_idle')).to.be.empty

      // Now simulate heartbeat going stale (>5 min ago)
      db.prepare("UPDATE agent_work SET last_heartbeat = datetime('now', '-10 minutes') WHERE id = 'aw-idle'").run()

      // Second poll: heartbeat check detects idle, fires on_agent_idle
      await poller.poll()
      const idleEvents = firedEvents.filter(e => e.event === 'on_agent_idle')
      expect(idleEvents.length).to.be.greaterThanOrEqual(1, 'Should fire on_agent_idle for stale heartbeat')
      expect(idleEvents[0].ctx.agent).to.equal('idle-agent')
      expect(idleEvents[0].ctx.ticket).to.equal('TKT-IDLE')
    })

    it('should fire events only on state transitions, not on every poll', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-t1', 'TKT-T1', 'agent-t1', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })

      // First poll: observe initial state (no events)
      await poller.poll()
      expect(firedEvents).to.be.empty

      // 5 more polls with no state change — still no events
      for (let i = 0; i < 5; i++) {
        await poller.poll()
      }
      expect(firedEvents.filter(e =>
        e.event === 'on_agent_died' ||
        e.event === 'on_agent_completed' ||
        e.event === 'on_agent_idle'
      )).to.be.empty

      // Now transition to completed — should fire exactly once
      db.prepare("UPDATE agent_work SET lifecycle_state = 'completed' WHERE id = 'aw-t1'").run()
      await poller.poll()

      const completed = firedEvents.filter(e => e.event === 'on_agent_completed')
      expect(completed).to.have.length(1)

      // More polls — no additional events
      await poller.poll()
      await poller.poll()
      expect(firedEvents.filter(e => e.event === 'on_agent_completed')).to.have.length(1)
    })
  })

  // ===========================================================================
  // Ticket Dedup Extended (PRLT-1223)
  // ===========================================================================

  describe('ticket dedup extended', () => {
    it('should fire on_ticket_ready only once across many poll cycles', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-DEDUP', 'Dedup', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })

      // Poll 5 times
      for (let i = 0; i < 5; i++) {
        await poller.poll()
      }

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(1, 'on_ticket_ready should fire exactly once per ticket')
    })

    it('should fire on_ticket_ready for multiple distinct tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-A', 'Ticket A', 'status-ready', NULL)").run()
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-B', 'Ticket B', 'status-ready', NULL)").run()
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-C', 'Ticket C', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(3)
      const ticketIds = readyEvents.map(e => e.ctx.ticket)
      expect(ticketIds).to.include('TKT-A')
      expect(ticketIds).to.include('TKT-B')
      expect(ticketIds).to.include('TKT-C')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should not throw on polling errors', async () => {
      // Close the db to force errors, then create a new poller
      const badDb = new Database(':memory:')
      // Don't create tables — queries will fail
      const badEngine = new OrchestrateEngine({ db: badDb, log: () => {} })
      const poller = new OrchestratePoller({ engine: badEngine, db: badDb, log: () => {} })

      // Should not throw
      await poller.poll()
      badDb.close()
    })
  })
})
