/**
 * Auto-Mapper for Transition Intents
 *
 * Auto-guesses intent-to-state mappings when connecting a board.
 * Uses provider state types first, then name heuristics.
 *
 * Supports:
 * - Many-to-one: multiple board columns can map to the same intent
 * - Custom intents: testing, blocked, rework beyond the base 7
 * - Ambiguous state detection: flags states that need user input
 *
 * Each provider can have different state type vocabularies:
 * - Linear: triage, backlog, unstarted, started, completed, canceled
 * - Jira: new, indeterminate, done, category-based
 * - Trello: no types (name heuristics only)
 */

import type { TransitionIntent } from './state-intents.js'
import { matchIntentByAliases, getDefaultIntent } from './state-intents.js'

export interface BoardState {
  id: string
  name: string
  type?: string
  position?: number
}

export interface IntentMapping {
  intent: TransitionIntent | string
  stateName: string
  stateId: string
  confidence: 'type' | 'name' | 'none'
}

/**
 * A state flagged as ambiguous — needs user disambiguation.
 */
export interface AmbiguousState {
  state: BoardState
  candidateIntents: Array<{ intent: string; reason: string }>
}

/**
 * Result of auto-mapping with disambiguation info.
 */
export interface AutoMapResult {
  mappings: IntentMapping[]
  ambiguous: AmbiguousState[]
  unmapped: BoardState[]
}

/**
 * Map from Linear state types to transition intents.
 * Linear has no native "review" type, so that's always resolved by name heuristics.
 */
const LINEAR_TYPE_TO_INTENT: Record<string, TransitionIntent> = {
  started: 'started',
  completed: 'completed',
  canceled: 'dropped',
  cancelled: 'dropped',
  backlog: 'paused',
  unstarted: 'ready',
}

/**
 * Map from Jira status category keys to transition intents.
 * Jira has 3 categories: new, indeterminate, done.
 * "needs_review" has no Jira category — resolved by name heuristics.
 */
const JIRA_CATEGORY_TO_INTENT: Record<string, TransitionIntent> = {
  new: 'ready',
  indeterminate: 'started',
  done: 'completed',
}

/**
 * Custom intent patterns for non-standard board columns.
 * These extend beyond the base 7 canonical intents.
 */
const CUSTOM_INTENT_PATTERNS: Array<{ intent: string; patterns: string[] }> = [
  { intent: 'testing', patterns: ['test', 'qa', 'quality'] },
  { intent: 'blocked', patterns: ['block', 'wait', 'feedback', 'impediment'] },
  { intent: 'rework', patterns: ['return', 'rework', 'revision', 'changes requested'] },
]

/**
 * States that are ambiguous and need user disambiguation.
 * Maps state name patterns to their possible intents.
 */
const AMBIGUOUS_PATTERNS: Array<{
  pattern: RegExp
  intents: Array<{ intent: string; reason: string }>
}> = [
  {
    pattern: /^closed$/i,
    intents: [
      { intent: 'completed', reason: 'Work is finished' },
      { intent: 'dropped', reason: 'Canceled or won\'t do' },
    ],
  },
  {
    pattern: /^not working on$/i,
    intents: [
      { intent: 'dropped', reason: 'Permanently removed' },
      { intent: 'paused', reason: 'Temporarily deprioritized' },
    ],
  },
]

/**
 * Auto-guess transition intent mappings from a list of board states.
 *
 * Strategy:
 * 1. For each intent, check if any state has a matching type (provider-specific)
 * 2. If no type match, fall back to name heuristics from DEFAULT_INTENTS aliases
 * 3. States can only be mapped to one intent (first match wins by intent priority)
 *
 * @param states - Available board states from the provider
 * @param providerType - Provider type for type-based mapping ('linear', 'jira', etc.)
 * @returns Array of intent mappings, one per matched intent
 */
export function autoMapIntents(
  states: BoardState[],
  providerType: 'linear' | 'jira' | 'trello' | 'asana' | 'shortcut' | 'clickup' | 'github' | 'pmo' = 'pmo',
): IntentMapping[] {
  const mappings: IntentMapping[] = []
  const usedStateIds = new Set<string>()

  // Priority order for intent resolution
  const intentOrder: TransitionIntent[] = [
    'started',
    'needs_review',
    'completed',
    'paused',
    'ready',
    'dropped',
  ]

  for (const intent of intentOrder) {
    // 1. Try type-based mapping (provider-specific)
    if (providerType === 'linear') {
      const typeMatch = states.find(s =>
        s.type && LINEAR_TYPE_TO_INTENT[s.type] === intent && !usedStateIds.has(s.id)
      )
      if (typeMatch) {
        mappings.push({
          intent,
          stateName: typeMatch.name,
          stateId: typeMatch.id,
          confidence: 'type',
        })
        usedStateIds.add(typeMatch.id)
        continue
      }
    }

    if (providerType === 'jira') {
      const typeMatch = states.find(s =>
        s.type && JIRA_CATEGORY_TO_INTENT[s.type] === intent && !usedStateIds.has(s.id)
      )
      if (typeMatch) {
        mappings.push({
          intent,
          stateName: typeMatch.name,
          stateId: typeMatch.id,
          confidence: 'type',
        })
        usedStateIds.add(typeMatch.id)
        continue
      }
    }

    // 2. Fall back to name heuristics from DEFAULT_INTENTS
    const intentDef = getDefaultIntent(intent)
    if (intentDef) {
      const availableStates = states.filter(s => !usedStateIds.has(s.id))
      const nameMatch = matchIntentByAliases(
        availableStates.map(s => ({ id: s.id, name: s.name })),
        intentDef,
      )
      if (nameMatch) {
        mappings.push({
          intent,
          stateName: nameMatch.name,
          stateId: nameMatch.id,
          confidence: 'name',
        })
        usedStateIds.add(nameMatch.id)
        continue
      }
    }
  }

  return mappings
}

/**
 * Extended auto-mapping that also detects:
 * - Ambiguous states needing user disambiguation
 * - Unmapped states that could be custom intents
 * - Many-to-one opportunities (multiple columns → same intent)
 */
export function autoMapWithDisambiguation(
  states: BoardState[],
  providerType: 'linear' | 'jira' | 'trello' | 'asana' | 'shortcut' | 'clickup' | 'github' | 'pmo' = 'pmo',
): AutoMapResult {
  // First pass: standard auto-mapping
  const mappings = autoMapIntents(states, providerType)
  const mappedStateIds = new Set(mappings.map(m => m.stateId))

  const ambiguous: AmbiguousState[] = []
  const unmapped: BoardState[] = []

  // Second pass: check remaining states
  for (const state of states) {
    if (mappedStateIds.has(state.id)) continue

    // Check if this is an ambiguous state
    const ambiguousMatch = AMBIGUOUS_PATTERNS.find(p => p.pattern.test(state.name))
    if (ambiguousMatch) {
      ambiguous.push({
        state,
        candidateIntents: ambiguousMatch.intents,
      })
      continue
    }

    // Check if it matches a custom intent pattern
    const customMatch = matchCustomIntent(state.name)
    if (customMatch) {
      mappings.push({
        intent: customMatch as TransitionIntent,
        stateName: state.name,
        stateId: state.id,
        confidence: 'name',
      })
      mappedStateIds.add(state.id)
      continue
    }

    // Check if this state could be many-to-one with an existing mapping
    const manyToOneMatch = findManyToOneMatch(state, mappings)
    if (manyToOneMatch) {
      mappings.push({
        intent: manyToOneMatch,
        stateName: state.name,
        stateId: state.id,
        confidence: 'name',
      })
      mappedStateIds.add(state.id)
      continue
    }

    // Truly unmapped
    unmapped.push(state)
  }

  return { mappings, ambiguous, unmapped }
}

/**
 * Check if a state name matches a custom intent pattern.
 */
function matchCustomIntent(stateName: string): string | null {
  const lower = stateName.toLowerCase()
  for (const { intent, patterns } of CUSTOM_INTENT_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) {
      return intent
    }
  }
  return null
}

/**
 * Check if an unmapped state is similar enough to an already-mapped state
 * to be a many-to-one candidate (same intent, different column name).
 *
 * Heuristics:
 * - "Duplicate" alongside "Canceled" → both map to `dropped`
 * - States with the same provider type as an existing mapping
 */
function findManyToOneMatch(state: BoardState, existingMappings: IntentMapping[]): string | null {
  const lower = state.name.toLowerCase()

  // Check if the state name matches known patterns for existing mapped intents
  const droppedPatterns = ['duplicate', 'won\'t fix', 'won\'t do', 'wontfix', 'obsolete']
  if (droppedPatterns.some(p => lower.includes(p))) {
    if (existingMappings.some(m => m.intent === 'dropped')) {
      return 'dropped'
    }
  }

  const backlogPatterns = ['new issue', 'new request', 'new functionality', 'intake', 'incoming']
  if (backlogPatterns.some(p => lower.includes(p))) {
    if (existingMappings.some(m => m.intent === 'backlog')) {
      return 'backlog'
    }
  }

  return null
}

/**
 * Detect custom action suggestions based on non-standard columns.
 * Returns suggestions like "You have Testing columns — want a QA action?"
 */
export function suggestCustomActions(
  mappings: IntentMapping[],
): string[] {
  const suggestions: string[] = []

  const testingMappings = mappings.filter(m => m.intent === 'testing')
  if (testingMappings.length > 0) {
    const names = testingMappings.map(m => m.stateName).join(' and ')
    suggestions.push(`You have ${names} — want to create a test action that moves tickets through QA?`)
  }

  const reworkMappings = mappings.filter(m => m.intent === 'rework')
  if (reworkMappings.length > 0) {
    const names = reworkMappings.map(m => m.stateName).join(' and ')
    suggestions.push(`You have ${names} — want to create a rework action that sends tickets back to development?`)
  }

  const blockedMappings = mappings.filter(m => m.intent === 'blocked')
  if (blockedMappings.length > 0) {
    const names = blockedMappings.map(m => m.stateName).join(' and ')
    suggestions.push(`You have ${names} — want to create a block action for dependency tracking?`)
  }

  return suggestions
}

/**
 * Format intent mappings for display to the user.
 *
 * @param mappings - The auto-guessed mappings
 * @param allStates - All available board states
 * @returns Array of display lines
 */
export function formatMappingTable(
  mappings: IntentMapping[],
  allStates: BoardState[],
): string[] {
  const lines: string[] = []
  const maxStateLen = Math.max(...allStates.map(s => s.name.length), 10)
  const maxIntentLen = Math.max(...mappings.map(m => m.intent.length), 10)

  // Header
  lines.push(`${'Board State'.padEnd(maxStateLen + 2)}${'Intent'.padEnd(maxIntentLen + 2)}Work Command`)
  lines.push(`${'─'.repeat(maxStateLen + 2)}${'─'.repeat(maxIntentLen + 2)}${'─'.repeat(20)}`)

  const intentToCommand: Record<string, string> = {
    started: 'work start',
    needs_review: 'work ready',
    completed: 'work ship',
    paused: 'work stop',
    ready: 'work groom',
    dropped: 'work drop',
    testing: '(custom)',
    rework: '(custom)',
    blocked: '(custom)',
  }

  // Map states to their intents
  const stateToMapping = new Map(mappings.map(m => [m.stateId, m]))

  for (const state of allStates) {
    const mapping = stateToMapping.get(state.id)
    const intentStr = mapping ? mapping.intent : '(unmapped)'
    const commandStr = mapping ? intentToCommand[mapping.intent] || '' : ''
    lines.push(`${state.name.padEnd(maxStateLen + 2)}${intentStr.padEnd(maxIntentLen + 2)}${commandStr}`)
  }

  return lines
}
