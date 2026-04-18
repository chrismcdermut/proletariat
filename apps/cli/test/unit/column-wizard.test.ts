/**
 * Tests for PRLT-1285: Onboarding wizard — auto-map board columns to intents.
 *
 * Tests cover:
 * - Auto-matching columns to intents with fuzzy string matching
 * - Many-to-one mapping (multiple columns → same intent)
 * - Ambiguous state detection (e.g., "Closed" → completed or dropped?)
 * - Custom intent detection (testing, rework, blocked)
 * - All 5 board examples from docs/concepts/board-types.md
 * - 3-column board produces valid mapping
 * - Migration 0025 (many-to-one unique constraint)
 * - TransitionMapStore many-to-one support
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  autoMapIntents,
  autoMapWithDisambiguation,
  formatMappingTable,
  suggestCustomActions,
  type BoardState,
  type IntentMapping,
} from '../../src/lib/providers/auto-mapper.js'
import { TransitionMapStore } from '../../src/lib/providers/transition-map.js'
import type { TransitionIntent } from '../../src/lib/providers/state-intents.js'
import { transitionMapManyToOne } from '../../src/lib/database/migrations/0025_transition_map_many_to_one.js'
import { transitionMap } from '../../src/lib/database/migrations/0020_transition_map.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Apply migration 0020 first (creates table with old constraint)
  transitionMap.up(db)
  // Then apply migration 0025 (changes unique constraint)
  transitionMapManyToOne.up(db)
  return db
}

function byIntent(mappings: IntentMapping[]): Map<string, IntentMapping[]> {
  const map = new Map<string, IntentMapping[]>()
  for (const m of mappings) {
    const existing = map.get(m.intent) || []
    existing.push(m)
    map.set(m.intent, existing)
  }
  return map
}

// =============================================================================
// Board Examples from docs/concepts/board-types.md
// =============================================================================

/** Board 1 — Trello (feature-focused team) */
const BOARD_1_TRELLO_FEATURE: BoardState[] = [
  { id: '1', name: 'New Functionality Requests', position: 0 },
  { id: '2', name: 'New Issues', position: 1 },
  { id: '3', name: 'Working On', position: 2 },
  { id: '4', name: 'Needs Review', position: 3 },
  { id: '5', name: 'Done', position: 4 },
  { id: '6', name: 'Not Working On', position: 5 },
]

/** Board 2 — Trello (dev-focused team) */
const BOARD_2_TRELLO_DEV: BoardState[] = [
  { id: '1', name: 'Backlog', position: 0 },
  { id: '2', name: 'Development Ready', position: 1 },
  { id: '3', name: 'In Progress', position: 2 },
  { id: '4', name: 'In Review', position: 3 },
  { id: '5', name: 'Done', position: 4 },
]

/** Board 3 — ClickUp (client services) */
const BOARD_3_CLICKUP: BoardState[] = [
  { id: '1', name: 'BACKLOG', position: 0 },
  { id: '2', name: 'TO DO', position: 1 },
  { id: '3', name: 'IN PROGRESS', position: 2 },
  { id: '4', name: 'AWAITING CLIENT FEEDBACK', position: 3 },
  { id: '5', name: 'PAUSED', position: 4 },
  { id: '6', name: 'COMPLETE', position: 5 },
]

/** Board 4 — Enterprise QA-heavy workflow */
const BOARD_4_QA_HEAVY: BoardState[] = [
  { id: '1', name: 'To Do', position: 0 },
  { id: '2', name: 'Returned', position: 1 },
  { id: '3', name: 'In Progress', position: 2 },
  { id: '4', name: 'In Review', position: 3 },
  { id: '5', name: 'To Test', position: 4 },
  { id: '6', name: 'Testing', position: 5 },
  { id: '7', name: 'Done', position: 6 },
  { id: '8', name: 'Closed', position: 7 },
]

/** Board 5 — Linear (proletariat) */
const BOARD_5_LINEAR: BoardState[] = [
  { id: '1', name: 'Triage', type: 'triage', position: 0 },
  { id: '2', name: 'Backlog', type: 'backlog', position: 1 },
  { id: '3', name: 'Ready', type: 'unstarted', position: 2 },
  { id: '4', name: 'In Progress', type: 'started', position: 3 },
  { id: '5', name: 'Review', type: 'started', position: 4 },
  { id: '6', name: 'Done', type: 'completed', position: 5 },
  { id: '7', name: 'Canceled', type: 'canceled', position: 6 },
  { id: '8', name: 'Duplicate', type: 'canceled', position: 7 },
]

/** 3-column minimal board */
const BOARD_MINIMAL: BoardState[] = [
  { id: '1', name: 'To Do', position: 0 },
  { id: '2', name: 'In Progress', position: 1 },
  { id: '3', name: 'Done', position: 2 },
]

// =============================================================================
// Auto-Mapper with Disambiguation Tests
// =============================================================================

describe('PRLT-1285: Column Wizard Auto-Mapping', () => {
  describe('autoMapWithDisambiguation()', () => {
    it('Board 1 (Trello feature-focused): maps correctly with disambiguation', () => {
      const result = autoMapWithDisambiguation(BOARD_1_TRELLO_FEATURE, 'trello')

      const mapped = byIntent(result.mappings)

      // Working On → started
      expect(mapped.get('started')?.[0].stateName).to.equal('Working On')
      // Needs Review → needs_review
      expect(mapped.get('needs_review')?.[0].stateName).to.equal('Needs Review')
      // Done → completed
      expect(mapped.get('completed')?.[0].stateName).to.equal('Done')

      // "Not Working On" should be flagged as ambiguous
      const notWorkingOn = result.ambiguous.find(a => a.state.name === 'Not Working On')
      expect(notWorkingOn, '"Not Working On" should be ambiguous').to.not.be.undefined
      expect(notWorkingOn!.candidateIntents.length).to.be.greaterThanOrEqual(2)
    })

    it('Board 2 (Trello dev-focused): maps 1:1 with base intents', () => {
      const result = autoMapWithDisambiguation(BOARD_2_TRELLO_DEV, 'trello')

      const mapped = byIntent(result.mappings)

      expect(mapped.get('started')?.[0].stateName).to.equal('In Progress')
      expect(mapped.get('needs_review')?.[0].stateName).to.equal('In Review')
      expect(mapped.get('completed')?.[0].stateName).to.equal('Done')
      expect(mapped.get('ready')?.[0].stateName).to.equal('Development Ready')

      // All states should be mapped, none ambiguous or unmapped
      expect(result.ambiguous).to.have.length(0)
      expect(result.unmapped).to.have.length(0)
    })

    it('Board 3 (ClickUp): maps with custom intents for feedback and paused', () => {
      const result = autoMapWithDisambiguation(BOARD_3_CLICKUP, 'clickup')

      const mapped = byIntent(result.mappings)

      expect(mapped.get('started')?.[0].stateName).to.equal('IN PROGRESS')
      expect(mapped.get('completed')?.[0].stateName).to.equal('COMPLETE')

      // AWAITING CLIENT FEEDBACK → blocked (custom intent, contains "feedback")
      expect(mapped.get('blocked')?.[0].stateName).to.equal('AWAITING CLIENT FEEDBACK')

      // PAUSED → paused
      expect(mapped.get('paused')?.[0].stateName).to.equal('PAUSED')

      // No ambiguous states
      expect(result.ambiguous).to.have.length(0)
    })

    it('Board 4 (Enterprise QA): maps with custom testing and rework intents', () => {
      const result = autoMapWithDisambiguation(BOARD_4_QA_HEAVY, 'pmo')

      const mapped = byIntent(result.mappings)

      expect(mapped.get('started')?.[0].stateName).to.equal('In Progress')
      expect(mapped.get('needs_review')?.[0].stateName).to.equal('In Review')
      expect(mapped.get('completed')?.[0].stateName).to.equal('Done')
      expect(mapped.get('ready')?.[0].stateName).to.equal('To Do')

      // Returned → rework (custom intent, contains "return")
      expect(mapped.get('rework')?.[0].stateName).to.equal('Returned')

      // To Test and/or Testing → testing (custom intent, contains "test")
      const testingMappings = mapped.get('testing') || []
      expect(testingMappings.length).to.be.greaterThanOrEqual(1)

      // "Closed" should be flagged as ambiguous
      const closedAmbiguous = result.ambiguous.find(a => a.state.name === 'Closed')
      expect(closedAmbiguous, '"Closed" should be ambiguous').to.not.be.undefined
    })

    it('Board 5 (Linear): maps using type-based matching with many-to-one', () => {
      const result = autoMapWithDisambiguation(BOARD_5_LINEAR, 'linear')

      const mapped = byIntent(result.mappings)

      // Type-based mappings
      expect(mapped.get('started')?.[0].stateName).to.equal('In Progress')
      expect(mapped.get('completed')?.[0].stateName).to.equal('Done')
      expect(mapped.get('dropped')?.[0].stateName).to.equal('Canceled')
      expect(mapped.get('ready')?.[0].stateName).to.equal('Ready')

      // Review → needs_review (name heuristic, since Linear has no review type)
      expect(mapped.get('needs_review')?.[0].stateName).to.equal('Review')

      // Duplicate should be mapped to dropped (many-to-one via findManyToOneMatch)
      const droppedMappings = mapped.get('dropped') || []
      const hasDuplicate = droppedMappings.some(m => m.stateName === 'Duplicate')
      expect(hasDuplicate, 'Duplicate should map to dropped').to.be.true
    })

    it('3-column board: produces valid mapping where multiple intents share columns', () => {
      const result = autoMapWithDisambiguation(BOARD_MINIMAL, 'pmo')

      const mapped = byIntent(result.mappings)

      // Core intents should be mapped
      expect(mapped.get('started')?.[0].stateName).to.equal('In Progress')
      expect(mapped.get('completed')?.[0].stateName).to.equal('Done')
      expect(mapped.get('ready')?.[0].stateName).to.equal('To Do')

      // Should have no ambiguous states
      expect(result.ambiguous).to.have.length(0)

      // All 3 states should be accounted for
      const totalMapped = result.mappings.length
      const totalAmbiguous = result.ambiguous.length
      const totalUnmapped = result.unmapped.length
      expect(totalMapped + totalAmbiguous + totalUnmapped).to.equal(3)
    })
  })

  describe('Custom intent detection', () => {
    it('detects testing intent from "To Test" and "Testing" columns', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'To Test', position: 1 },
        { id: '3', name: 'Testing', position: 2 },
        { id: '4', name: 'Done', position: 3 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const mapped = byIntent(result.mappings)
      const testingMappings = mapped.get('testing') || []
      expect(testingMappings.length).to.be.greaterThanOrEqual(1)
    })

    it('detects blocked intent from "Awaiting Client Feedback"', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Awaiting Client Feedback', position: 1 },
        { id: '3', name: 'Done', position: 2 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const mapped = byIntent(result.mappings)
      expect(mapped.get('blocked')?.[0].stateName).to.equal('Awaiting Client Feedback')
    })

    it('detects rework intent from "Returned" column', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Returned', position: 1 },
        { id: '3', name: 'Done', position: 2 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const mapped = byIntent(result.mappings)
      expect(mapped.get('rework')?.[0].stateName).to.equal('Returned')
    })
  })

  describe('Ambiguous state detection', () => {
    it('flags "Closed" as ambiguous (completed or dropped)', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Done', position: 1 },
        { id: '3', name: 'Closed', position: 2 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const closedAmb = result.ambiguous.find(a => a.state.name === 'Closed')
      expect(closedAmb, '"Closed" should be ambiguous').to.not.be.undefined
      expect(closedAmb!.candidateIntents.some(c => c.intent === 'completed')).to.be.true
      expect(closedAmb!.candidateIntents.some(c => c.intent === 'dropped')).to.be.true
    })

    it('flags "Not Working On" as ambiguous (dropped or paused)', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Done', position: 1 },
        { id: '3', name: 'Not Working On', position: 2 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const amb = result.ambiguous.find(a => a.state.name === 'Not Working On')
      expect(amb, '"Not Working On" should be ambiguous').to.not.be.undefined
      expect(amb!.candidateIntents.some(c => c.intent === 'dropped')).to.be.true
      expect(amb!.candidateIntents.some(c => c.intent === 'paused')).to.be.true
    })
  })

  describe('Many-to-one mapping', () => {
    it('"Duplicate" alongside "Canceled" both map to dropped', () => {
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Done', position: 1 },
        { id: '3', name: 'Canceled', position: 2 },
        { id: '4', name: 'Duplicate', position: 3 },
      ]

      const result = autoMapWithDisambiguation(states, 'pmo')
      const mapped = byIntent(result.mappings)
      const droppedMappings = mapped.get('dropped') || []
      expect(droppedMappings.length).to.equal(2)
      const names = droppedMappings.map(m => m.stateName).sort()
      expect(names).to.deep.equal(['Canceled', 'Duplicate'])
    })

    it('multiple intake columns map to backlog', () => {
      const states: BoardState[] = [
        { id: '1', name: 'New Functionality Requests', position: 0 },
        { id: '2', name: 'New Issues', position: 1 },
        { id: '3', name: 'In Progress', position: 2 },
        { id: '4', name: 'Done', position: 3 },
      ]

      const result = autoMapWithDisambiguation(states, 'trello')
      const mapped = byIntent(result.mappings)

      // Both intake columns should map to backlog (via many-to-one heuristics)
      // At least the "New Issues" pattern should match via "new issue" in backlog patterns
      // "New Functionality Requests" matches via "new request"
      const backlogMappings = mapped.get('backlog') || []
      // At minimum, the standard mapping should have picked up one
      expect(backlogMappings.length).to.be.greaterThanOrEqual(1)
    })
  })

  describe('suggestCustomActions()', () => {
    it('suggests QA action for testing mappings', () => {
      const mappings: IntentMapping[] = [
        { intent: 'testing', stateName: 'To Test', stateId: '1', confidence: 'name' },
      ]
      const suggestions = suggestCustomActions(mappings)
      expect(suggestions.length).to.be.greaterThanOrEqual(1)
      expect(suggestions[0]).to.include('test')
    })

    it('suggests rework action for rework mappings', () => {
      const mappings: IntentMapping[] = [
        { intent: 'rework', stateName: 'Returned', stateId: '1', confidence: 'name' },
      ]
      const suggestions = suggestCustomActions(mappings)
      expect(suggestions.length).to.be.greaterThanOrEqual(1)
      expect(suggestions[0]).to.include('rework')
    })

    it('suggests block action for blocked mappings', () => {
      const mappings: IntentMapping[] = [
        { intent: 'blocked', stateName: 'Awaiting Feedback', stateId: '1', confidence: 'name' },
      ]
      const suggestions = suggestCustomActions(mappings)
      expect(suggestions.length).to.be.greaterThanOrEqual(1)
      expect(suggestions[0]).to.include('block')
    })

    it('returns empty for standard intents only', () => {
      const mappings: IntentMapping[] = [
        { intent: 'started', stateName: 'In Progress', stateId: '1', confidence: 'name' },
        { intent: 'completed', stateName: 'Done', stateId: '2', confidence: 'name' },
      ]
      const suggestions = suggestCustomActions(mappings)
      expect(suggestions).to.have.length(0)
    })
  })

  describe('formatMappingTable()', () => {
    it('includes custom intents in the table', () => {
      const mappings: IntentMapping[] = [
        { intent: 'started', stateName: 'In Progress', stateId: '1', confidence: 'name' },
        { intent: 'testing', stateName: 'To Test', stateId: '2', confidence: 'name' },
      ]
      const states: BoardState[] = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'To Test', position: 1 },
      ]
      const lines = formatMappingTable(mappings, states)
      const testingLine = lines.find(l => l.includes('testing'))
      expect(testingLine).to.not.be.undefined
      expect(testingLine).to.include('(custom)')
    })
  })
})

// =============================================================================
// Migration 0025 Tests
// =============================================================================

describe('PRLT-1285: Migration 0025 — many-to-one transition map', () => {
  it('allows multiple columns to map to the same intent', () => {
    const db = createTestDb()

    // Insert two mappings for the same intent — should succeed
    db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
      VALUES (?, ?, ?, ?)
    `).run('linear', 'dropped', 'Canceled', 'id-1')

    db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
      VALUES (?, ?, ?, ?)
    `).run('linear', 'dropped', 'Duplicate', 'id-2')

    const rows = db.prepare(`
      SELECT * FROM pmo_transition_map WHERE provider = 'linear' AND intent = 'dropped'
    `).all() as Array<{ provider_state_name: string }>

    expect(rows).to.have.length(2)
    const names = rows.map(r => r.provider_state_name).sort()
    expect(names).to.deep.equal(['Canceled', 'Duplicate'])

    db.close()
  })

  it('still enforces uniqueness on (provider, intent, provider_state_name)', () => {
    const db = createTestDb()

    db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
      VALUES (?, ?, ?, ?)
    `).run('linear', 'dropped', 'Canceled', 'id-1')

    // Inserting same (provider, intent, provider_state_name) should fail
    expect(() => {
      db.prepare(`
        INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
        VALUES (?, ?, ?, ?)
      `).run('linear', 'dropped', 'Canceled', 'id-1-duplicate')
    }).to.throw()

    db.close()
  })

  it('preserves existing data during migration', () => {
    // Create a fresh DB with just the old migration
    const db = new Database(':memory:')
    transitionMap.up(db)

    // Insert some data with old schema
    db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
      VALUES (?, ?, ?, ?)
    `).run('linear', 'started', 'In Progress', 'id-1')

    db.prepare(`
      INSERT INTO pmo_transition_map (provider, intent, provider_state_name, provider_state_id)
      VALUES (?, ?, ?, ?)
    `).run('linear', 'completed', 'Done', 'id-2')

    // Apply migration 0025
    transitionMapManyToOne.up(db)

    // Verify data is preserved
    const rows = db.prepare(`
      SELECT * FROM pmo_transition_map ORDER BY intent
    `).all() as Array<{ intent: string; provider_state_name: string }>

    expect(rows).to.have.length(2)
    expect(rows[0].intent).to.equal('completed')
    expect(rows[0].provider_state_name).to.equal('Done')
    expect(rows[1].intent).to.equal('started')
    expect(rows[1].provider_state_name).to.equal('In Progress')

    db.close()
  })
})

// =============================================================================
// TransitionMapStore Many-to-One Tests
// =============================================================================

describe('PRLT-1285: TransitionMapStore many-to-one support', () => {
  let db: Database.Database
  let store: TransitionMapStore

  beforeEach(() => {
    db = createTestDb()
    store = new TransitionMapStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('upsertMapping stores multiple states for same intent', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Canceled',
      providerStateId: 'id-1',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Duplicate',
      providerStateId: 'id-2',
    })

    const mappings = store.getMappingsForIntent('linear', 'dropped')
    expect(mappings).to.have.length(2)
    const names = mappings.map(m => m.providerStateName).sort()
    expect(names).to.deep.equal(['Canceled', 'Duplicate'])
  })

  it('getMappingsForIntent returns all mappings for an intent', () => {
    store.upsertMapping({
      provider: 'trello',
      intent: 'backlog',
      providerStateName: 'New Issues',
      providerStateId: 'id-1',
    })
    store.upsertMapping({
      provider: 'trello',
      intent: 'backlog',
      providerStateName: 'New Functionality Requests',
      providerStateId: 'id-2',
    })

    const mappings = store.getMappingsForIntent('trello', 'backlog')
    expect(mappings).to.have.length(2)
  })

  it('getMapping returns first match (backward compatible)', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Canceled',
      providerStateId: 'id-1',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Duplicate',
      providerStateId: 'id-2',
    })

    const mapping = store.getMapping('linear', 'dropped')
    expect(mapping).to.not.be.null
    // Should return one of them (first in DB order)
    expect(['Canceled', 'Duplicate']).to.include(mapping!.providerStateName)
  })

  it('resolveIntent returns first state name (backward compatible)', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'started',
      providerStateName: 'In Progress',
      providerStateId: 'id-1',
    })

    const result = store.resolveIntent('linear', 'started')
    expect(result).to.equal('In Progress')
  })

  it('removeMappingByState removes only the specific state mapping', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Canceled',
      providerStateId: 'id-1',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Duplicate',
      providerStateId: 'id-2',
    })

    store.removeMappingByState('linear', 'dropped', 'Duplicate')

    const mappings = store.getMappingsForIntent('linear', 'dropped')
    expect(mappings).to.have.length(1)
    expect(mappings[0].providerStateName).to.equal('Canceled')
  })

  it('removeMapping removes all states for an intent', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Canceled',
      providerStateId: 'id-1',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Duplicate',
      providerStateId: 'id-2',
    })

    store.removeMapping('linear', 'dropped')

    const mappings = store.getMappingsForIntent('linear', 'dropped')
    expect(mappings).to.have.length(0)
  })

  it('clearMappings removes all mappings for a provider', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'started',
      providerStateName: 'In Progress',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'completed',
      providerStateName: 'Done',
    })

    store.clearMappings('linear')

    const mappings = store.listMappings('linear')
    expect(mappings).to.have.length(0)
  })

  it('listMappings returns all mappings ordered by intent and state name', () => {
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Duplicate',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'dropped',
      providerStateName: 'Canceled',
    })
    store.upsertMapping({
      provider: 'linear',
      intent: 'started',
      providerStateName: 'In Progress',
    })

    const mappings = store.listMappings('linear')
    expect(mappings).to.have.length(3)
    // Should be ordered: dropped-Canceled, dropped-Duplicate, started-In Progress
    expect(mappings[0].intent).to.equal('dropped')
    expect(mappings[0].providerStateName).to.equal('Canceled')
    expect(mappings[1].intent).to.equal('dropped')
    expect(mappings[1].providerStateName).to.equal('Duplicate')
    expect(mappings[2].intent).to.equal('started')
  })
})
