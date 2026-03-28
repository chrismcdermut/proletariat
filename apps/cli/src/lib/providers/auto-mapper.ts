/**
 * Auto-Mapper for Transition Intents
 *
 * Auto-guesses intent-to-state mappings when connecting a board.
 * Uses provider state types first, then name heuristics.
 *
 * Each provider can have different state type vocabularies:
 * - Linear: triage, backlog, unstarted, started, completed, canceled
 * - Jira: new, indeterminate, done, category-based
 * - Trello: no types (name heuristics only)
 */

import type { TransitionIntent } from './state-intents.js'
import { DEFAULT_INTENTS, matchIntentByAliases, getDefaultIntent } from './state-intents.js'

export interface BoardState {
  id: string
  name: string
  type?: string
  position?: number
}

export interface IntentMapping {
  intent: TransitionIntent
  stateName: string
  stateId: string
  confidence: 'type' | 'name' | 'none'
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
  providerType: 'linear' | 'jira' | 'trello' | 'asana' | 'shortcut' | 'clickup' | 'pmo' = 'pmo',
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
