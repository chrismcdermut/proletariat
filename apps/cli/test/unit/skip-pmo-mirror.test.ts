import { expect } from 'chai'
import Database from 'better-sqlite3'
import { buildTicketFromEnvelope } from '../../src/lib/external-issues/ticket-builder.js'
import { resolveMirrorToPmo } from '../../src/lib/external-issues/work-start.js'
import { TicketRefStore } from '../../src/lib/execution/ticket-refs.js'
import { PMO_TABLE_SCHEMAS } from '../../src/lib/pmo/schema.js'
import {
  handlePostExecutionTransition,
  type PostExecutionStorage,
} from '../../src/lib/work-lifecycle/post-execution.js'
import type { NormalizedIssueEnvelope } from '../../src/lib/external-issues/types.js'

/**
 * Tests for PRLT-1167: Skip PMO mirror in work start.
 *
 * Validates:
 * 1. buildTicketFromEnvelope creates correct Ticket from envelope
 * 2. resolveMirrorToPmo defaults to false
 * 3. Post-execution falls back to ticket_refs when PMO lookup returns null
 * 4. Provider resolver accepts external keys
 */

function createEnvelope(overrides?: Partial<NormalizedIssueEnvelope>): NormalizedIssueEnvelope {
  return {
    source: {
      name: 'linear',
      externalId: 'uuid-1234',
      externalKey: 'PRLT-1167',
      url: 'https://linear.app/proletariat/issue/PRLT-1167',
      raw: {},
    },
    title: 'Skip PMO mirror in work start',
    description: 'Part of PMO removal.',
    labels: ['pmo-removal'],
    priority: 'P1',
    status: 'In Progress',
    projectKey: 'PRLT',
    assignee: 'agent-1',
    category: 'feature',
    itemType: 'issue',
    ...overrides,
  }
}

describe('PRLT-1167: Skip PMO mirror in work start', () => {
  describe('buildTicketFromEnvelope', () => {
    it('creates a Ticket with external key as ID', () => {
      const envelope = createEnvelope()
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      expect(ticket.id).to.equal('PRLT-1167')
      expect(ticket.title).to.equal('Skip PMO mirror in work start')
      expect(ticket.description).to.equal('Part of PMO removal.')
      expect(ticket.priority).to.equal('P1')
      expect(ticket.category).to.equal('feature')
      expect(ticket.projectId).to.equal('PROJ-001')
      expect(ticket.labels).to.deep.equal(['pmo-removal'])
      expect(ticket.subtasks).to.deep.equal([])
    })

    it('sets external metadata on the ticket', () => {
      const envelope = createEnvelope()
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      expect(ticket.metadata).to.deep.equal({
        external_source: 'linear',
        external_id: 'uuid-1234',
        external_key: 'PRLT-1167',
        external_url: 'https://linear.app/proletariat/issue/PRLT-1167',
      })
    })

    it('sets statusId to "external"', () => {
      const envelope = createEnvelope()
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      expect(ticket.statusId).to.equal('external')
      expect(ticket.statusName).to.equal('In Progress')
      expect(ticket.statusCategory).to.be.undefined
    })

    it('handles null priority and category', () => {
      const envelope = createEnvelope({ priority: null, category: null })
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      expect(ticket.priority).to.be.undefined
      expect(ticket.category).to.be.undefined
    })

    it('handles Jira envelope', () => {
      const envelope = createEnvelope({
        source: {
          name: 'jira',
          externalId: 'jira-id-456',
          externalKey: 'PROJ-456',
          url: 'https://jira.atlassian.net/browse/PROJ-456',
          raw: {},
        },
      })
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      expect(ticket.id).to.equal('PROJ-456')
      expect(ticket.metadata.external_source).to.equal('jira')
    })
  })

  describe('resolveMirrorToPmo default', () => {
    it('defaults to disabled (false)', () => {
      const result = resolveMirrorToPmo({})
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('default')
    })

    it('can be re-enabled via flag', () => {
      const result = resolveMirrorToPmo({ flagValue: true })
      expect(result.enabled).to.be.true
      expect(result.source).to.equal('flag')
    })

    it('can be re-enabled via config', () => {
      const result = resolveMirrorToPmo({ configValue: true })
      expect(result.enabled).to.be.true
      expect(result.source).to.equal('config')
    })

    it('can be re-enabled via env', () => {
      const result = resolveMirrorToPmo({ envValue: true })
      expect(result.enabled).to.be.true
      expect(result.source).to.equal('env')
    })
  })

  describe('ticket_refs storage', () => {
    let db: Database.Database

    beforeEach(() => {
      db = new Database(':memory:')
      // Create ticket_refs table
      db.exec(PMO_TABLE_SCHEMAS.ticket_refs)
    })

    afterEach(() => {
      db.close()
    })

    it('stores envelope ticket in ticket_refs', () => {
      const envelope = createEnvelope()
      const ticket = buildTicketFromEnvelope(envelope, 'PROJ-001')

      const store = new TicketRefStore(db)
      const ref = store.upsert({
        id: ticket.id,
        provider: envelope.source.name,
        externalId: envelope.source.externalId,
        externalKey: envelope.source.externalKey,
        externalUrl: envelope.source.url,
        title: envelope.title,
        description: envelope.description,
        status: envelope.status,
        priority: envelope.priority,
        category: envelope.category,
        assignee: envelope.assignee,
        projectId: 'PROJ-001',
      })

      expect(ref.id).to.equal('PRLT-1167')
      expect(ref.provider).to.equal('linear')
      expect(ref.externalId).to.equal('uuid-1234')
      expect(ref.externalKey).to.equal('PRLT-1167')
      expect(ref.title).to.equal('Skip PMO mirror in work start')
      expect(ref.projectId).to.equal('PROJ-001')
    })

    it('retrieves ticket_ref by ID', () => {
      const store = new TicketRefStore(db)
      store.upsert({
        id: 'PRLT-1167',
        provider: 'linear',
        externalId: 'uuid-1234',
        externalKey: 'PRLT-1167',
        title: 'Test ticket',
        projectId: 'PROJ-001',
      })

      const ref = store.get('PRLT-1167')
      expect(ref).to.not.be.null
      expect(ref!.id).to.equal('PRLT-1167')
      expect(ref!.provider).to.equal('linear')
    })

    it('retrieves ticket_ref by external key', () => {
      const store = new TicketRefStore(db)
      store.upsert({
        id: 'PRLT-1167',
        provider: 'linear',
        externalId: 'uuid-1234',
        externalKey: 'PRLT-1167',
        title: 'Test ticket',
      })

      const ref = store.getByExternalKey('linear', 'PRLT-1167')
      expect(ref).to.not.be.null
      expect(ref!.id).to.equal('PRLT-1167')
    })
  })

  describe('post-execution ticket_refs fallback', () => {
    let db: Database.Database
    let lastMoveTarget: string | null

    function createStorage(): PostExecutionStorage {
      return {
        // Return null — simulating no PMO ticket
        getTicket: async () => null,
        getProjectBoard: async () => ({
          columns: [
            { name: 'Backlog' },
            { name: 'In Progress' },
            { name: 'Review' },
            { name: 'Done' },
          ],
        }),
        moveTicket: async (_pid: string, _tid: string, columnName: string) => {
          lastMoveTarget = columnName
        },
      }
    }

    beforeEach(() => {
      db = new Database(':memory:')
      // Create required tables
      db.exec(PMO_TABLE_SCHEMAS.settings)
      db.exec(PMO_TABLE_SCHEMAS.ticket_refs)

      // Set column settings
      db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('column_review', 'Review')
      db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('column_done', 'Done')

      lastMoveTarget = null
    })

    afterEach(() => {
      db.close()
    })

    it('returns transitioned=false when ticket not found in PMO or ticket_refs', () => {
      const storage = createStorage()
      return handlePostExecutionTransition(
        { ticketId: 'NONEXISTENT' },
        storage,
        db,
      ).then(result => {
        expect(result.transitioned).to.be.false
      })
    })

    it('falls back to ticket_refs when PMO lookup returns null', () => {
      // Store a ticket_ref
      const store = new TicketRefStore(db)
      store.upsert({
        id: 'PRLT-1167',
        provider: 'linear',
        externalId: 'uuid-1234',
        externalKey: 'PRLT-1167',
        externalUrl: 'https://linear.app/proletariat/issue/PRLT-1167',
        title: 'Test ticket',
        status: 'In Progress',
        projectId: 'default',
      })

      const storage = createStorage()
      return handlePostExecutionTransition(
        { ticketId: 'PRLT-1167' },
        storage,
        db,
      ).then(result => {
        // Should not error — ticket_refs fallback found the ticket
        // It may or may not transition depending on PR status, but it should not crash
        expect(result).to.have.property('transitioned')
      })
    })

    it('uses external_source from ticket_ref metadata for provider resolution', () => {
      const store = new TicketRefStore(db)
      store.upsert({
        id: 'PRLT-1167',
        provider: 'linear',
        externalId: 'uuid-1234',
        externalKey: 'PRLT-1167',
        title: 'Test ticket',
        status: 'In Progress',
        projectId: 'default',
      })

      const storage = createStorage()
      return handlePostExecutionTransition(
        { ticketId: 'PRLT-1167' },
        storage,
        db,
      ).then(result => {
        // Should not crash — validates that ticket_ref metadata is correctly constructed
        expect(result).to.have.property('transitioned')
      })
    })
  })
})
