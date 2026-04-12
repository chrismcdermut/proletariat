import { expect } from 'chai'
import Database from 'better-sqlite3'
import {
  getWorkflowConfig,
  setWorkflowConfig,
  resolveWorkflowTarget,
  getWorkColumnSetting,
  setWorkColumnSetting,
  DEFAULT_WORK_COLUMNS,
  type WorkflowConfig,
} from '../../src/lib/work-lifecycle/settings.js'
import {
  reconcileTicket,
  reconcileAgentSpawned,
  type ReconcileContext,
} from '../../src/lib/sync/reconciler.js'
import type { Ticket } from '../../src/lib/pmo/types.js'
import {
  getColumnSettingsForTemplate,
} from '../../src/lib/pmo/templates-builtin.js'

/**
 * Unit tests for configurable workflow state mapping (PRLT-1227).
 *
 * Tests cover:
 * - WorkflowConfig read/write through pmo_settings
 * - resolveWorkflowTarget() intent-to-column resolution
 * - Reconciler respects custom WorkflowConfig
 * - Poller ready status detection with configured columns
 * - Template column settings include review and backlog
 */

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  return db
}

// =============================================================================
// WorkflowConfig
// =============================================================================

describe('WorkflowConfig', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  describe('getWorkflowConfig()', () => {
    it('should return defaults when no settings are stored', () => {
      const config = getWorkflowConfig(db)
      expect(config.planned).to.equal('Planned')
      expect(config.in_progress).to.equal('In Progress')
      expect(config.review).to.equal('Review')
      expect(config.done).to.equal('Done')
      expect(config.backlog).to.equal('Backlog')
    })

    it('should return stored settings', () => {
      setWorkColumnSetting(db, 'planned', 'Todo')
      setWorkColumnSetting(db, 'in_progress', 'Working On')
      setWorkColumnSetting(db, 'review', 'QA')
      setWorkColumnSetting(db, 'done', 'Shipped')
      setWorkColumnSetting(db, 'backlog', 'Inbox')

      const config = getWorkflowConfig(db)
      expect(config.planned).to.equal('Todo')
      expect(config.in_progress).to.equal('Working On')
      expect(config.review).to.equal('QA')
      expect(config.done).to.equal('Shipped')
      expect(config.backlog).to.equal('Inbox')
    })

    it('should fall back to defaults for missing keys', () => {
      setWorkColumnSetting(db, 'review', 'Pending Approval')

      const config = getWorkflowConfig(db)
      expect(config.planned).to.equal('Planned')
      expect(config.review).to.equal('Pending Approval')
      expect(config.done).to.equal('Done')
    })
  })

  describe('setWorkflowConfig()', () => {
    it('should save a partial config', () => {
      setWorkflowConfig(db, { review: 'QA', done: 'Shipped' })

      expect(getWorkColumnSetting(db, 'review')).to.equal('QA')
      expect(getWorkColumnSetting(db, 'done')).to.equal('Shipped')
      // Unset keys remain defaults
      expect(getWorkColumnSetting(db, 'planned')).to.equal('Planned')
    })

    it('should save a full config', () => {
      setWorkflowConfig(db, {
        planned: 'Up Next',
        in_progress: 'Doing',
        review: 'QA',
        done: 'Deployed',
        backlog: 'Triage',
      })

      const config = getWorkflowConfig(db)
      expect(config.planned).to.equal('Up Next')
      expect(config.in_progress).to.equal('Doing')
      expect(config.review).to.equal('QA')
      expect(config.done).to.equal('Deployed')
      expect(config.backlog).to.equal('Triage')
    })

    it('should overwrite existing settings', () => {
      setWorkflowConfig(db, { done: 'Shipped' })
      setWorkflowConfig(db, { done: 'Released' })

      expect(getWorkColumnSetting(db, 'done')).to.equal('Released')
    })
  })

  describe('resolveWorkflowTarget()', () => {
    it('should resolve "done" to configured done column', () => {
      setWorkColumnSetting(db, 'done', 'Shipped')
      expect(resolveWorkflowTarget(db, 'done')).to.equal('Shipped')
    })

    it('should resolve "review" to configured review column', () => {
      setWorkColumnSetting(db, 'review', 'QA')
      expect(resolveWorkflowTarget(db, 'review')).to.equal('QA')
    })

    it('should resolve "in-progress" to configured in_progress column', () => {
      setWorkColumnSetting(db, 'in_progress', 'Working On')
      expect(resolveWorkflowTarget(db, 'in-progress')).to.equal('Working On')
    })

    it('should resolve "ready" to configured planned column', () => {
      setWorkColumnSetting(db, 'planned', 'Up Next')
      expect(resolveWorkflowTarget(db, 'ready')).to.equal('Up Next')
    })

    it('should resolve "backlog" to configured backlog column', () => {
      setWorkColumnSetting(db, 'backlog', 'Inbox')
      expect(resolveWorkflowTarget(db, 'backlog')).to.equal('Inbox')
    })

    it('should return defaults for unconfigured intents', () => {
      expect(resolveWorkflowTarget(db, 'done')).to.equal('Done')
      expect(resolveWorkflowTarget(db, 'review')).to.equal('Review')
    })

    it('should return unknown targets unchanged', () => {
      expect(resolveWorkflowTarget(db, 'Custom Column')).to.equal('Custom Column')
      expect(resolveWorkflowTarget(db, 'Triage')).to.equal('Triage')
    })

    it('should be case-insensitive for intent matching', () => {
      setWorkColumnSetting(db, 'done', 'Shipped')
      expect(resolveWorkflowTarget(db, 'Done')).to.equal('Shipped')
      expect(resolveWorkflowTarget(db, 'DONE')).to.equal('Shipped')
    })
  })

  describe('DEFAULT_WORK_COLUMNS', () => {
    it('should include backlog', () => {
      expect(DEFAULT_WORK_COLUMNS).to.have.property('backlog', 'Backlog')
    })

    it('should have all five workflow stages', () => {
      expect(Object.keys(DEFAULT_WORK_COLUMNS)).to.have.members([
        'planned', 'in_progress', 'review', 'done', 'backlog',
      ])
    })
  })
})

// =============================================================================
// Reconciler with WorkflowConfig
// =============================================================================

describe('Reconciler with WorkflowConfig', () => {
  function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 'TKT-1',
      title: 'Test ticket',
      description: '',
      status: 'In Progress',
      statusName: 'In Progress',
      statusCategory: 'started',
      priority: 'P1',
      category: 'feature',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      ...overrides,
    } as Ticket
  }

  const mergedPR = {
    number: 42,
    state: 'MERGED' as const,
    title: 'fix bug',
    headBranch: 'fix/bug',
    baseBranch: 'main',
    url: 'https://github.com/test/repo/pull/42',
    isDraft: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  }

  const openPR = {
    number: 42,
    state: 'OPEN' as const,
    title: 'fix bug',
    headBranch: 'fix/bug',
    baseBranch: 'main',
    url: 'https://github.com/test/repo/pull/42',
    isDraft: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  }

  const closedPR = {
    number: 42,
    state: 'CLOSED' as const,
    title: 'fix bug',
    headBranch: 'fix/bug',
    baseBranch: 'main',
    url: 'https://github.com/test/repo/pull/42',
    isDraft: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  }

  const greenChecks = [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', url: 'https://ci.example.com' }]

  describe('uses default target statuses without config', () => {
    it('should use "Done" for merged PR', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket(),
        pr: mergedPR,
        checks: [],
        hasActiveExecution: false,
      }
      const action = reconcileTicket(ctx)
      expect(action).to.exist
      expect(action!.targetStatus).to.equal('Done')
    })

    it('should use "Review" for open PR with green CI', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket(),
        pr: openPR,
        checks: greenChecks,
        hasActiveExecution: false,
      }
      const action = reconcileTicket(ctx)
      expect(action).to.exist
      expect(action!.targetStatus).to.equal('Review')
    })
  })

  describe('uses custom target statuses with config', () => {
    const customConfig: WorkflowConfig = {
      planned: 'Up Next',
      in_progress: 'Working On',
      review: 'QA',
      done: 'Shipped',
      backlog: 'Inbox',
    }

    it('should use configured "done" for merged PR', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket(),
        pr: mergedPR,
        checks: [],
        hasActiveExecution: false,
      }
      const action = reconcileTicket(ctx, customConfig)
      expect(action).to.exist
      expect(action!.type).to.equal('move_to_done')
      expect(action!.targetStatus).to.equal('Shipped')
    })

    it('should use configured "review" for open PR', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket(),
        pr: openPR,
        checks: greenChecks,
        hasActiveExecution: false,
      }
      const action = reconcileTicket(ctx, customConfig)
      expect(action).to.exist
      expect(action!.type).to.equal('move_to_review')
      expect(action!.targetStatus).to.equal('QA')
    })

    it('should use configured "backlog" for closed PR on review ticket', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusName: 'QA' }),
        pr: closedPR,
        checks: [],
        hasActiveExecution: false,
      }
      const action = reconcileTicket(ctx, customConfig)
      expect(action).to.exist
      expect(action!.type).to.equal('move_to_backlog')
      expect(action!.targetStatus).to.equal('Inbox')
    })

    it('should detect review status using configured name', () => {
      // With custom config, "QA" is the review column
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusName: 'QA' }),
        pr: openPR,
        checks: greenChecks,
        hasActiveExecution: false,
      }
      // Should NOT produce move_to_review because the ticket is already in review (QA)
      const action = reconcileTicket(ctx, customConfig)
      expect(action === null || action!.type !== 'move_to_review').to.be.true
    })
  })

  describe('reconcileAgentSpawned with config', () => {
    it('should use configured "in_progress" for agent-spawned tickets', () => {
      const tickets = [
        makeTicket({ id: 'TKT-10', statusCategory: 'unstarted' }),
      ]
      const activeAgentIds = new Set(['TKT-10'])

      const customConfig: WorkflowConfig = {
        planned: 'Up Next',
        in_progress: 'Doing',
        review: 'QA',
        done: 'Deployed',
        backlog: 'Inbox',
      }

      const actions = reconcileAgentSpawned(tickets, activeAgentIds, customConfig)
      expect(actions).to.have.length(1)
      expect(actions[0].targetStatus).to.equal('Doing')
    })

    it('should use default "In Progress" without config', () => {
      const tickets = [
        makeTicket({ id: 'TKT-10', statusCategory: 'unstarted' }),
      ]
      const activeAgentIds = new Set(['TKT-10'])

      const actions = reconcileAgentSpawned(tickets, activeAgentIds)
      expect(actions).to.have.length(1)
      expect(actions[0].targetStatus).to.equal('In Progress')
    })
  })
})

// =============================================================================
// Template Column Settings
// =============================================================================

describe('Template Column Settings', () => {
  it('default template should include review and backlog', () => {
    const settings = getColumnSettingsForTemplate('default', [])
    expect(settings.column_review).to.equal('Review')
    expect(settings.column_backlog).to.equal('Backlog')
  })

  it('linear template should map review to "In Review"', () => {
    const settings = getColumnSettingsForTemplate('linear', [])
    expect(settings.column_review).to.equal('In Review')
    expect(settings.column_backlog).to.equal('Backlog')
  })

  it('bug-smash template should map review to "Verifying"', () => {
    const settings = getColumnSettingsForTemplate('bug-smash', [])
    expect(settings.column_review).to.equal('Verifying')
    expect(settings.column_backlog).to.equal('Reported')
  })

  it('custom template should infer review and backlog from column names', () => {
    const columns = ['Triage', 'Ready', 'In Progress', 'QA Review', 'Done']
    const settings = getColumnSettingsForTemplate('custom', columns)
    expect(settings.column_review).to.equal('QA Review')
    expect(settings.column_backlog).to.equal('Triage')
  })

  it('custom template should fallback for review when no match', () => {
    const columns = ['Backlog', 'Todo', 'Working', 'Complete']
    const settings = getColumnSettingsForTemplate('custom', columns)
    // Falls back to second-to-last column
    expect(settings.column_review).to.equal('Working')
  })
})

// =============================================================================
// Poller Ready Status Resolution
// =============================================================================

describe('Poller Ready Status Resolution', () => {
  function createPollerDb(): Database.Database {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
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
        assignee TEXT
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_work (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        role TEXT NOT NULL DEFAULT 'worker'
      )
    `)
    return db
  }

  it('should find tickets by configured ready status name', () => {
    const db = createPollerDb()

    // Set up custom workflow: "Up Next" is the ready column
    db.prepare("INSERT INTO pmo_settings (key, value) VALUES ('column_planned', 'Up Next')").run()
    db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('s1', 'Up Next', 'unstarted')").run()
    db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('s2', 'Working', 'started')").run()
    db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Ready ticket', 's1', NULL)").run()
    db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-2', 'Working ticket', 's2', NULL)").run()

    // Query using the same logic as the poller
    const config = getWorkflowConfig(db)
    const readyStatusName = config.planned

    const readyTickets = db.prepare(`
      SELECT t.id, t.title
      FROM pmo_tickets t
      JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
      WHERE LOWER(ws.name) = LOWER(?)
        AND t.assignee IS NULL
        AND t.id NOT IN (
          SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
        )
      LIMIT 10
    `).all(readyStatusName) as Array<{ id: string; title: string }>

    expect(readyTickets).to.have.length(1)
    expect(readyTickets[0].id).to.equal('TKT-1')

    db.close()
  })

  it('should fall back to unstarted category when no config', () => {
    const db = createPollerDb()

    db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('s1', 'Ready', 'unstarted')").run()
    db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('s2', 'In Progress', 'started')").run()
    db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Ready ticket', 's1', NULL)").run()

    const readyTickets = db.prepare(`
      SELECT t.id, t.title
      FROM pmo_tickets t
      JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
      WHERE ws.category = 'unstarted'
        AND t.assignee IS NULL
        AND t.id NOT IN (
          SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
        )
      LIMIT 10
    `).all() as Array<{ id: string; title: string }>

    expect(readyTickets).to.have.length(1)
    expect(readyTickets[0].id).to.equal('TKT-1')

    db.close()
  })
})
