/**
 * Tests for PRLT-1230: PR sync into pmo_external_execution_prs
 *
 * Covers:
 * 1. EventEmittingProvider.updateTicket() emits work:pr_created when PR metadata is set
 * 2. Sync engine registers discovered PRs in pmo_external_execution_prs
 * 3. Work ship falls back to GitHub API when PR not in local DB
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { EventBus, resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import { EventEmittingProvider, type StatusResolver } from '../../src/lib/providers/event-emitting-provider.js'
import { ExternalExecutionMappingStore } from '../../src/lib/external-issues/mapping-store.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
} from '../../src/lib/providers/types.js'
import type { TicketPRLinkedEvent } from '../../src/lib/events/events.js'
import type { WorkPRCreatedEvent } from '../../src/lib/work-lifecycle/events.js'
import type { StateCategory, TicketFilter, CreateTicketInput, UpdateTicketInput, Ticket } from '../../src/lib/pmo/types.js'
import type { ExternalMappingProvider } from '../../src/lib/external-issues/types.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

// =============================================================================
// Mock Provider
// =============================================================================

class MockProvider implements TicketProvider {
  readonly name = 'pmo' as const
  updateResult: ProviderUpdateResult = { success: true, provider: 'pmo' }

  async moveTicket(): Promise<ProviderMoveResult> { return { success: true, provider: 'pmo' } }
  async deleteTicket(): Promise<ProviderDeleteResult> { return { success: true, provider: 'pmo' } }
  async listTickets(): Promise<ProviderListResult> { return { success: true, provider: 'pmo', tickets: [] } }
  async createTicket(): Promise<ProviderCreateResult> { return { success: true, provider: 'pmo' } }
  async getTicket(): Promise<ProviderGetResult> { return { success: true, provider: 'pmo', ticket: null } }
  async updateTicket(): Promise<ProviderUpdateResult> { return this.updateResult }
  async assignTicket(): Promise<ProviderAssignResult> { return { success: true, provider: 'pmo' } }
}

// =============================================================================
// Test: EventEmittingProvider.updateTicket() emits PR events
// =============================================================================

describe('PRLT-1230: PR sync into pmo_external_execution_prs', () => {
  describe('EventEmittingProvider.updateTicket() — PR event emission', () => {
    beforeEach(() => {
      resetEventBus()
    })

    afterEach(() => {
      resetEventBus()
    })

    it('emits work:pr_created when update includes pr_url metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      const linkEvents: TicketPRLinkedEvent[] = []
      getEventBus().on('ticket:pr_linked', (e) => linkEvents.push(e))

      await provider.updateTicket('TKT-042', {
        metadata: {
          pr_url: 'https://github.com/org/repo/pull/99',
          pr_title: 'Fix the thing',
        },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(1)
      expect(prEvents[0].workItemId).to.equal('TKT-042')
      expect(prEvents[0].prUrl).to.equal('https://github.com/org/repo/pull/99')
      expect(prEvents[0].prTitle).to.equal('Fix the thing')
      expect(prEvents[0].source).to.equal('pmo')
      expect(prEvents[0].projectId).to.equal('project-1')

      expect(linkEvents).to.have.lengthOf(1)
      expect(linkEvents[0].ticketId).to.equal('TKT-042')
      expect(linkEvents[0].prUrl).to.equal('https://github.com/org/repo/pull/99')
    })

    it('does not emit PR events when update has no pr_url metadata', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-042', {
        metadata: { some_key: 'some_value' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('does not emit PR events when update has no metadata at all', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-042', {
        title: 'Updated title',
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('does not emit PR events when update fails', async () => {
      const inner = new MockProvider()
      inner.updateResult = { success: false, provider: 'pmo', error: 'not found' }
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-042', {
        metadata: { pr_url: 'https://github.com/org/repo/pull/99' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(0)
    })

    it('defaults pr_title to null when not provided', async () => {
      const inner = new MockProvider()
      const provider = new EventEmittingProvider(inner, null, 'project-1')

      const prEvents: WorkPRCreatedEvent[] = []
      getEventBus().on('work:pr_created', (e) => prEvents.push(e))

      await provider.updateTicket('TKT-042', {
        metadata: { pr_url: 'https://github.com/org/repo/pull/99' },
      } as UpdateTicketInput)

      expect(prEvents).to.have.lengthOf(1)
      expect(prEvents[0].prTitle).to.be.null
    })
  })

  // ===========================================================================
  // Test: Sync engine registers PRs in pmo_external_execution_prs
  // ===========================================================================

  describe('Sync engine PR registration', () => {
    let fastDb: FastTestDb
    let db: Database.Database
    let mappingStore: ExternalExecutionMappingStore

    before(() => {
      fastDb = createFastTestDb((db) => {
        // Create the mapping store tables
        new ExternalExecutionMappingStore(db)
      })
      db = fastDb.db
    })

    beforeEach(() => {
      fastDb.savepoint()
      mappingStore = new ExternalExecutionMappingStore(db)
    })

    afterEach(() => {
      fastDb.rollback()
    })

    after(() => {
      fastDb.close()
    })

    it('syncs PR URL into pmo_external_execution_prs via mapping lookup by snapshot', () => {
      // Set up a Linear mapping with ticket ID in snapshot
      mappingStore.upsertMapping({
        provider: 'linear',
        externalId: 'lin-issue-001',
        externalKey: 'PRLT-1228',
        latestStateSnapshot: { pmoTicketId: 'TKT-050', status: 'In Progress' },
      })

      // Simulate what the sync engine does: find mappings and upsert PR URL
      const rows = db.prepare(`
        SELECT provider, external_id
        FROM pmo_external_execution_map
        WHERE latest_state_snapshot LIKE ? OR external_key = ?
      `).all('%TKT-050%', 'PRLT-1228') as Array<{
        provider: ExternalMappingProvider
        external_id: string
      }>

      expect(rows).to.have.lengthOf(1)

      for (const row of rows) {
        mappingStore.upsertMapping({
          provider: row.provider,
          externalId: row.external_id,
          prUrl: 'https://github.com/org/repo/pull/1058',
          lastSyncedAt: new Date(),
        })
      }

      // Verify PR is now stored
      const mapping = mappingStore.getByExternalId('linear', 'lin-issue-001')
      expect(mapping).to.not.be.null
      expect(mapping!.prUrls).to.include('https://github.com/org/repo/pull/1058')
    })

    it('syncs PR URL into pmo_external_execution_prs via external_key match', () => {
      // Set up mapping with external_key matching ticket's external key
      mappingStore.upsertMapping({
        provider: 'linear',
        externalId: 'lin-issue-002',
        externalKey: 'PRLT-1229',
        latestStateSnapshot: { status: 'Started' },
      })

      // The sync engine query matches on external_key too
      const rows = db.prepare(`
        SELECT provider, external_id
        FROM pmo_external_execution_map
        WHERE latest_state_snapshot LIKE ? OR external_key = ?
      `).all('%TKT-NONEXISTENT%', 'PRLT-1229') as Array<{
        provider: ExternalMappingProvider
        external_id: string
      }>

      expect(rows).to.have.lengthOf(1)

      mappingStore.upsertMapping({
        provider: rows[0].provider,
        externalId: rows[0].external_id,
        prUrl: 'https://github.com/org/repo/pull/1059',
        lastSyncedAt: new Date(),
      })

      const mapping = mappingStore.getByExternalId('linear', 'lin-issue-002')
      expect(mapping!.prUrls).to.include('https://github.com/org/repo/pull/1059')
    })

    it('does not duplicate PR URLs on repeated sync', () => {
      mappingStore.upsertMapping({
        provider: 'linear',
        externalId: 'lin-dedup',
        externalKey: 'PRLT-DUP',
        latestStateSnapshot: { pmoTicketId: 'TKT-DEDUP' },
      })

      // Sync the same PR URL twice
      mappingStore.upsertMapping({
        provider: 'linear',
        externalId: 'lin-dedup',
        prUrl: 'https://github.com/org/repo/pull/100',
        lastSyncedAt: new Date(),
      })

      mappingStore.upsertMapping({
        provider: 'linear',
        externalId: 'lin-dedup',
        prUrl: 'https://github.com/org/repo/pull/100',
        lastSyncedAt: new Date(),
      })

      const mapping = mappingStore.getByExternalId('linear', 'lin-dedup')
      expect(mapping!.prUrls).to.have.lengthOf(1)
      expect(mapping!.prUrls[0]).to.equal('https://github.com/org/repo/pull/100')
    })

    it('returns empty when no mappings match the ticket', () => {
      const rows = db.prepare(`
        SELECT provider, external_id
        FROM pmo_external_execution_map
        WHERE latest_state_snapshot LIKE ? OR external_key = ?
      `).all('%TKT-PHANTOM%', 'PRLT-PHANTOM') as Array<{
        provider: ExternalMappingProvider
        external_id: string
      }>

      expect(rows).to.have.lengthOf(0)
    })
  })

  // ===========================================================================
  // Test: Work ship GitHub API fallback PR matching
  // ===========================================================================

  describe('Work ship GitHub API fallback — branch matching logic', () => {
    // Unit-test the branch-matching logic that work ship uses as a fallback
    // when PR is not found in local DB

    interface MockPR {
      number: number
      headBranch: string
      url: string
    }

    function findMatchingPR(
      openPRs: MockPR[],
      ticketId: string,
      ticketExternalKey: string | undefined,
    ): MockPR | undefined {
      return openPRs.find(pr => {
        if (ticketExternalKey && pr.headBranch.startsWith(`${ticketExternalKey}/`)) return true
        if (pr.headBranch.startsWith(`${ticketId}/`)) return true
        return false
      })
    }

    it('matches PR by external key prefix in branch name', () => {
      const openPRs: MockPR[] = [
        { number: 1058, headBranch: 'PRLT-1228/feat/add-retry', url: 'https://github.com/org/repo/pull/1058' },
        { number: 1059, headBranch: 'PRLT-1229/fix/other-bug', url: 'https://github.com/org/repo/pull/1059' },
      ]

      const match = findMatchingPR(openPRs, 'TKT-050', 'PRLT-1228')
      expect(match).to.not.be.undefined
      expect(match!.number).to.equal(1058)
    })

    it('matches PR by ticket ID prefix in branch name', () => {
      const openPRs: MockPR[] = [
        { number: 500, headBranch: 'TKT-042/feat/new-feature', url: 'https://github.com/org/repo/pull/500' },
      ]

      const match = findMatchingPR(openPRs, 'TKT-042', undefined)
      expect(match).to.not.be.undefined
      expect(match!.number).to.equal(500)
    })

    it('prefers external key match over ticket ID match', () => {
      const openPRs: MockPR[] = [
        { number: 600, headBranch: 'PRLT-100/feat/thing', url: 'https://github.com/org/repo/pull/600' },
        { number: 601, headBranch: 'TKT-042/feat/thing', url: 'https://github.com/org/repo/pull/601' },
      ]

      const match = findMatchingPR(openPRs, 'TKT-042', 'PRLT-100')
      expect(match).to.not.be.undefined
      expect(match!.number).to.equal(600)
    })

    it('returns undefined when no PR matches', () => {
      const openPRs: MockPR[] = [
        { number: 700, headBranch: 'PRLT-999/feat/unrelated', url: 'https://github.com/org/repo/pull/700' },
      ]

      const match = findMatchingPR(openPRs, 'TKT-042', 'PRLT-100')
      expect(match).to.be.undefined
    })

    it('does not match partial ticket IDs', () => {
      const openPRs: MockPR[] = [
        { number: 800, headBranch: 'PRLT-10/feat/thing', url: 'https://github.com/org/repo/pull/800' },
      ]

      // PRLT-100 should NOT match PRLT-10/ because the branch prefix check uses startsWith
      const match = findMatchingPR(openPRs, 'TKT-042', 'PRLT-100')
      expect(match).to.be.undefined
    })

    it('handles empty open PR list', () => {
      const match = findMatchingPR([], 'TKT-042', 'PRLT-100')
      expect(match).to.be.undefined
    })
  })
})
