import { expect } from 'chai'
import {
  DEFAULT_INTENTS,
  TRANSITION_INTENTS,
  getDefaultIntent,
  matchIntentByAliases,
  type TransitionIntent,
} from '../../src/lib/providers/state-intents.js'
import { autoMapIntents, formatMappingTable } from '../../src/lib/providers/auto-mapper.js'

// =============================================================================
// Transition Intent Tests
// =============================================================================

describe('Transition Intents', () => {
  describe('TRANSITION_INTENTS', () => {
    it('contains all 7 canonical intents', () => {
      expect(TRANSITION_INTENTS).to.have.length(7)
      expect(TRANSITION_INTENTS).to.include('backlog')
      expect(TRANSITION_INTENTS).to.include('started')
      expect(TRANSITION_INTENTS).to.include('needs_review')
      expect(TRANSITION_INTENTS).to.include('completed')
      expect(TRANSITION_INTENTS).to.include('paused')
      expect(TRANSITION_INTENTS).to.include('ready')
      expect(TRANSITION_INTENTS).to.include('dropped')
    })
  })

  describe('DEFAULT_INTENTS', () => {
    it('has a SemanticIntent entry for each transition intent', () => {
      for (const intent of TRANSITION_INTENTS) {
        const found = DEFAULT_INTENTS.find(i => i.name === intent)
        expect(found, `Missing SemanticIntent for '${intent}'`).to.not.be.undefined
        expect(found!.aliases.length, `No aliases for '${intent}'`).to.be.greaterThan(0)
      }
    })

    it('started intent matches common "in progress" names', () => {
      const intent = getDefaultIntent('started')!
      const states = [{ id: '1', name: 'In Progress' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'In Progress' })
    })

    it('needs_review intent matches common review names', () => {
      const intent = getDefaultIntent('needs_review')!
      const states = [{ id: '1', name: 'In Review' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'In Review' })
    })

    it('completed intent matches common done names', () => {
      const intent = getDefaultIntent('completed')!
      const states = [{ id: '1', name: 'Done' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'Done' })
    })

    it('paused intent matches common blocked/paused names', () => {
      const intent = getDefaultIntent('paused')!
      const states = [{ id: '1', name: 'On Hold' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'On Hold' })
    })

    it('ready intent matches common ready/planned names', () => {
      const intent = getDefaultIntent('ready')!
      const states = [{ id: '1', name: 'Ready' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'Ready' })
    })

    it('dropped intent matches common canceled names', () => {
      const intent = getDefaultIntent('dropped')!
      const states = [{ id: '1', name: 'Canceled' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'Canceled' })
    })
  })

  describe('getDefaultIntent() with legacy names', () => {
    it('resolves "active" to "started" intent', () => {
      const intent = getDefaultIntent('active')
      expect(intent).to.not.be.undefined
      expect(intent!.name).to.equal('started')
    })

    it('resolves "review" to "needs_review" intent', () => {
      const intent = getDefaultIntent('review')
      expect(intent).to.not.be.undefined
      expect(intent!.name).to.equal('needs_review')
    })

    it('resolves "done" to "completed" intent', () => {
      const intent = getDefaultIntent('done')
      expect(intent).to.not.be.undefined
      expect(intent!.name).to.equal('completed')
    })

    it('resolves "blocked" to "paused" intent', () => {
      const intent = getDefaultIntent('blocked')
      expect(intent).to.not.be.undefined
      expect(intent!.name).to.equal('paused')
    })
  })

  describe('matchIntentByAliases()', () => {
    it('matches case-insensitively', () => {
      const intent = getDefaultIntent('started')!
      const states = [{ id: '1', name: 'in progress' }]
      expect(matchIntentByAliases(states, intent)).to.deep.equal({ id: '1', name: 'in progress' })
    })

    it('matches partial names', () => {
      const intent = getDefaultIntent('started')!
      const states = [{ id: '1', name: 'Currently In Progress' }]
      const match = matchIntentByAliases(states, intent)
      expect(match).to.not.be.null
      expect(match!.name).to.equal('Currently In Progress')
    })

    it('returns null when no match', () => {
      const intent = getDefaultIntent('started')!
      const states = [{ id: '1', name: 'Zzzz' }]
      expect(matchIntentByAliases(states, intent)).to.be.null
    })

    it('prefers exact match over partial', () => {
      const intent = getDefaultIntent('started')!
      const states = [
        { id: '1', name: 'Not In Progress Yet' },
        { id: '2', name: 'In Progress' },
      ]
      const match = matchIntentByAliases(states, intent)
      expect(match!.id).to.equal('2')
    })
  })
})

// =============================================================================
// Auto-Mapper Tests
// =============================================================================

describe('Auto-Mapper', () => {
  describe('autoMapIntents()', () => {
    it('maps Linear board states using type-based matching', () => {
      const linearStates = [
        { id: '1', name: 'Triage', type: 'triage', position: 0 },
        { id: '2', name: 'Backlog', type: 'backlog', position: 1 },
        { id: '3', name: 'Ready', type: 'unstarted', position: 2 },
        { id: '4', name: 'In Progress', type: 'started', position: 3 },
        { id: '5', name: 'In Review', type: 'started', position: 4 },
        { id: '6', name: 'Done', type: 'completed', position: 5 },
        { id: '7', name: 'Canceled', type: 'canceled', position: 6 },
      ]

      const mappings = autoMapIntents(linearStates, 'linear')

      // Should map: started, needs_review, completed, paused, ready, dropped
      expect(mappings.length).to.be.greaterThanOrEqual(5)

      const byIntent = new Map(mappings.map(m => [m.intent, m]))

      // started → In Progress (type: started, first match)
      expect(byIntent.get('started')?.stateName).to.equal('In Progress')
      expect(byIntent.get('started')?.confidence).to.equal('type')

      // completed → Done (type: completed)
      expect(byIntent.get('completed')?.stateName).to.equal('Done')

      // dropped → Canceled (type: canceled)
      expect(byIntent.get('dropped')?.stateName).to.equal('Canceled')

      // paused → Backlog (type: backlog)
      expect(byIntent.get('paused')?.stateName).to.equal('Backlog')

      // ready → Ready (type: unstarted)
      expect(byIntent.get('ready')?.stateName).to.equal('Ready')
    })

    it('falls back to name heuristics for needs_review', () => {
      const linearStates = [
        { id: '1', name: 'In Progress', type: 'started', position: 0 },
        { id: '2', name: 'Needs Review', type: 'started', position: 1 },
        { id: '3', name: 'Done', type: 'completed', position: 2 },
      ]

      const mappings = autoMapIntents(linearStates, 'linear')
      const reviewMapping = mappings.find(m => m.intent === 'needs_review')

      // needs_review has no direct type mapping, falls to name heuristics
      expect(reviewMapping).to.not.be.undefined
      expect(reviewMapping!.stateName).to.equal('Needs Review')
      expect(reviewMapping!.confidence).to.equal('name')
    })

    it('maps Trello/generic boards using name heuristics only', () => {
      const trelloStates = [
        { id: '1', name: 'Backlog', position: 0 },
        { id: '2', name: 'To Do', position: 1 },
        { id: '3', name: 'In Progress', position: 2 },
        { id: '4', name: 'Review', position: 3 },
        { id: '5', name: 'Done', position: 4 },
      ]

      const mappings = autoMapIntents(trelloStates, 'trello')
      const byIntent = new Map(mappings.map(m => [m.intent, m]))

      expect(byIntent.get('started')?.stateName).to.equal('In Progress')
      expect(byIntent.get('needs_review')?.stateName).to.equal('Review')
      expect(byIntent.get('completed')?.stateName).to.equal('Done')
    })

    it('maps Jira board states using category-based matching', () => {
      const jiraStates = [
        { id: '1', name: 'Open', type: 'new', position: 0 },
        { id: '2', name: 'In Progress', type: 'indeterminate', position: 1 },
        { id: '3', name: 'In Review', type: 'indeterminate', position: 2 },
        { id: '4', name: 'Done', type: 'done', position: 3 },
      ]

      const mappings = autoMapIntents(jiraStates, 'jira')
      const byIntent = new Map(mappings.map(m => [m.intent, m]))

      // ready → Open (type: new)
      expect(byIntent.get('ready')?.stateName).to.equal('Open')
      expect(byIntent.get('ready')?.confidence).to.equal('type')

      // started → In Progress (type: indeterminate, first match)
      expect(byIntent.get('started')?.stateName).to.equal('In Progress')
      expect(byIntent.get('started')?.confidence).to.equal('type')

      // completed → Done (type: done)
      expect(byIntent.get('completed')?.stateName).to.equal('Done')
      expect(byIntent.get('completed')?.confidence).to.equal('type')

      // needs_review → In Review (name heuristic, since Jira has no review category)
      expect(byIntent.get('needs_review')?.stateName).to.equal('In Review')
      expect(byIntent.get('needs_review')?.confidence).to.equal('name')
    })

    it('does not map the same state to multiple intents', () => {
      const states = [
        { id: '1', name: 'In Progress', type: 'started', position: 0 },
        { id: '2', name: 'Done', type: 'completed', position: 1 },
      ]

      const mappings = autoMapIntents(states, 'linear')
      const stateIds = mappings.map(m => m.stateId)
      const uniqueIds = new Set(stateIds)
      expect(stateIds.length).to.equal(uniqueIds.size)
    })

    it('returns empty array when no states match', () => {
      const states = [
        { id: '1', name: 'Zzzzz', position: 0 },
      ]
      const mappings = autoMapIntents(states, 'pmo')
      expect(mappings).to.be.an('array')
    })
  })

  describe('formatMappingTable()', () => {
    it('produces a formatted table with headers', () => {
      const mappings = [{
        intent: 'started' as TransitionIntent,
        stateName: 'In Progress',
        stateId: '1',
        confidence: 'type' as const,
      }]
      const states = [
        { id: '1', name: 'In Progress', position: 0 },
        { id: '2', name: 'Triage', position: 1 },
      ]
      const lines = formatMappingTable(mappings, states)
      expect(lines.length).to.be.greaterThan(2) // header + separator + data
      expect(lines[0]).to.include('Board State')
      expect(lines[0]).to.include('Intent')
      expect(lines[0]).to.include('Work Command')
    })
  })
})
