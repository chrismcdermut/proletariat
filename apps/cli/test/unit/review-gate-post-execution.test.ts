import { expect } from 'chai'
import Database from 'better-sqlite3'
import { PMO_TABLE_SCHEMAS } from '../../src/lib/pmo/schema.js'
import { setReviewGateSetting } from '../../src/lib/pmo/utils.js'
import {
  handlePostExecutionTransition,
  type PostExecutionContext,
  type PostExecutionStorage,
} from '../../src/lib/work-lifecycle/post-execution.js'

/**
 * Tests for post-execution transition behavior with review gate modes (PRLT-1069).
 *
 * Validates that the review gate mode correctly influences:
 * - Target column (Review vs Done)
 * - PR requirement (auto mode skips PR check)
 */
describe('Review Gate — Post-Execution Transition', () => {
  let db: Database.Database

  // In-memory ticket store for tests
  let tickets: Record<string, {
    id: string
    projectId: string
    statusName: string
    statusCategory: 'started' | 'backlog' | 'completed'
    metadata: Record<string, string>
  }>

  let boardColumns: string[]
  let lastMoveTarget: string | null

  function createStorage(): PostExecutionStorage {
    return {
      getTicket: async (id: string) => {
        const t = tickets[id]
        if (!t) return null
        return {
          id: t.id,
          projectId: t.projectId,
          statusName: t.statusName,
          statusCategory: t.statusCategory,
          metadata: t.metadata,
        }
      },
      getProjectBoard: async (_projectId: string) => ({
        columns: boardColumns.map(name => ({ name })),
      }),
      moveTicket: async (_projectId: string, _ticketId: string, columnName: string) => {
        lastMoveTarget = columnName
      },
    }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(PMO_TABLE_SCHEMAS.settings)

    // Set up column settings
    db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('column_review', 'Review')
    db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('column_done', 'Done')

    boardColumns = ['Backlog', 'In Progress', 'Review', 'Done']
    lastMoveTarget = null

    tickets = {
      'TKT-001': {
        id: 'TKT-001',
        projectId: 'default',
        statusName: 'In Progress',
        statusCategory: 'started',
        metadata: { pr_url: 'https://github.com/org/repo/pull/1' },
      },
    }
  })

  afterEach(() => {
    db.close()
  })

  describe('required mode (default)', () => {
    it('should move ticket to Review column', async () => {
      const context: PostExecutionContext = { ticketId: 'TKT-001' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Review')
      expect(result.reviewGate).to.equal('required')
      expect(lastMoveTarget).to.equal('Review')
    })

    it('should require PR URL in metadata', async () => {
      tickets['TKT-001'].metadata = {} // No PR URL
      const context: PostExecutionContext = { ticketId: 'TKT-001' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.false
    })
  })

  describe('auto mode', () => {
    it('should move ticket to Done column (skips Review)', async () => {
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'auto' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Done')
      expect(result.reviewGate).to.equal('auto')
      expect(lastMoveTarget).to.equal('Done')
    })

    it('should not require PR URL (auto ships directly)', async () => {
      tickets['TKT-001'].metadata = {} // No PR URL
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'auto' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Done')
    })
  })

  describe('post mode', () => {
    it('should move ticket to Review column (human reviews post-merge)', async () => {
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'post' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Review')
      expect(result.reviewGate).to.equal('post')
      expect(lastMoveTarget).to.equal('Review')
    })

    it('should require PR URL in metadata', async () => {
      tickets['TKT-001'].metadata = {} // No PR URL
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'post' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.false
    })
  })

  describe('workspace setting integration', () => {
    it('should use workspace review_gate setting when no context override', async () => {
      setReviewGateSetting(db, 'auto')
      const context: PostExecutionContext = { ticketId: 'TKT-001' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Done')
      expect(result.reviewGate).to.equal('auto')
    })

    it('should prefer context.reviewGate over workspace setting', async () => {
      setReviewGateSetting(db, 'auto')
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'required' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.true
      expect(result.toState).to.equal('Review')
      expect(result.reviewGate).to.equal('required')
    })
  })

  describe('edge cases', () => {
    it('should not transition tickets not in started category', async () => {
      tickets['TKT-001'].statusCategory = 'backlog'
      const context: PostExecutionContext = { ticketId: 'TKT-001', reviewGate: 'auto' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.false
    })

    it('should not transition when target column not found', async () => {
      boardColumns = ['Backlog', 'In Progress'] // No Review or Done
      const context: PostExecutionContext = { ticketId: 'TKT-001' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.false
    })

    it('should not transition when ticket already in target state', async () => {
      tickets['TKT-001'].statusName = 'Review'
      const context: PostExecutionContext = { ticketId: 'TKT-001' }
      const result = await handlePostExecutionTransition(context, createStorage(), db)

      expect(result.transitioned).to.be.false
    })
  })
})
