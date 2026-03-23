/**
 * State Resolution Engine
 *
 * Resolves semantic intents (e.g., 'review', 'active', 'done') to actual
 * PM tool states at runtime. Never caches state IDs across calls.
 *
 * Resolution flow:
 * 1. Always fetch fresh states from the PM provider
 * 2. Check user config — `state-map.{intent}` overrides exact-match against fetched states
 * 3. Match against built-in semantic intent aliases
 * 4. No config + no alias match → LLM resolves (pass available states to LLM)
 * 5. No match → skip (don't move, log warning)
 *
 * The same move() function works across Linear, Trello, ClickUp, Jira, etc. —
 * each provider implements fetchStates() differently but returns the same shape.
 * Resolution logic is provider-agnostic.
 */

import type { TicketProvider } from './types.js'
import type { ProviderStorage } from './types.js'
import { SettingsStore } from '../database/settings-store.js'
import { DEFAULT_INTENTS, matchIntentByAliases, getDefaultIntent } from './state-intents.js'
import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A state from a PM provider, normalized to a common shape.
 * Every provider (Linear, Trello, ClickUp, PMO) returns states in this format.
 */
export interface PMState {
  id: string
  name: string
}

/**
 * Interface that providers must implement to support the state resolution engine.
 * This is a superset of TicketProvider — providers that want to participate
 * in intent-based resolution need fetchStates().
 */
export interface PMProvider {
  /** Fetch all available states for a ticket's project/board. Always fresh — never cached. */
  fetchStates(ticketId: string): Promise<PMState[]>
  /** Move a ticket to a specific state by ID. */
  moveTicket(ticketId: string, stateId: string): Promise<{ success: boolean; error?: string }>
}

/**
 * Result of a state resolution attempt.
 */
export interface StateResolutionResult {
  /** Whether the move succeeded */
  success: boolean
  /** How the state was resolved */
  resolvedVia?: 'config' | 'alias' | 'llm' | 'skipped'
  /** The resolved state name */
  stateName?: string
  /** The resolved state ID */
  stateId?: string
  /** Warning message if the move was skipped */
  warning?: string
  /** Error message if the move failed */
  error?: string
}

/**
 * Config key prefix for state-map overrides.
 * e.g., `state-map.review` → "Awaiting Client Feedback"
 */
const STATE_MAP_PREFIX = 'state-map.'

// ---------------------------------------------------------------------------
// LLM Resolution
// ---------------------------------------------------------------------------

/**
 * Use the LLM to resolve which available state best matches a semantic intent.
 *
 * Sends the list of available states and the intent to the Anthropic API.
 * Returns the matching state ID, or null if no match.
 *
 * Requires ANTHROPIC_API_KEY to be set.
 */
export async function llmResolveState(
  states: PMState[],
  intent: string,
): Promise<PMState | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return null
  }

  const stateList = states.map(s => `- "${s.name}" (id: ${s.id})`).join('\n')

  const prompt = `You are a state resolution assistant. Given a list of available workflow states from a project management tool and a semantic intent, pick the state that best matches the intent.

Available states:
${stateList}

Semantic intent: "${intent}"
${getDefaultIntent(intent) ? `Intent description: ${getDefaultIntent(intent)!.description}` : ''}

Respond with ONLY the exact state ID that best matches this intent. If no state matches, respond with "NONE".`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>
    }

    const text = data.content?.[0]?.text?.trim()
    if (!text || text === 'NONE') {
      return null
    }

    // The LLM should return a state ID — find the matching state
    const match = states.find(s => s.id === text)
    if (match) return match

    // Fallback: LLM might have returned a state name instead of ID
    const nameMatch = states.find(s => s.name.toLowerCase() === text.toLowerCase())
    if (nameMatch) return nameMatch

    return null
  } catch {
    // LLM call failed — non-fatal, fall through to skip
    return null
  }
}

// ---------------------------------------------------------------------------
// Config Resolution
// ---------------------------------------------------------------------------

/**
 * Check user config for a state-map override for the given intent.
 * Config stores state NAMES, not IDs.
 *
 * @param db - Database instance for settings lookup
 * @param intent - Semantic intent name (e.g., 'review')
 * @returns The configured state name, or null if not set
 */
export function getStateMapConfig(db: Database.Database, intent: string): string | null {
  try {
    const settings = new SettingsStore(db)
    return settings.get(`${STATE_MAP_PREFIX}${intent}`)
  } catch {
    return null
  }
}

/**
 * Set a state-map config override for an intent.
 *
 * @param db - Database instance
 * @param intent - Semantic intent name
 * @param stateName - The state name to map to
 */
export function setStateMapConfig(db: Database.Database, intent: string, stateName: string): void {
  const settings = new SettingsStore(db)
  settings.set(`${STATE_MAP_PREFIX}${intent}`, stateName)
}

/**
 * Remove a state-map config override for an intent.
 */
export function deleteStateMapConfig(db: Database.Database, intent: string): void {
  const settings = new SettingsStore(db)
  settings.delete(`${STATE_MAP_PREFIX}${intent}`)
}

/**
 * List all state-map config overrides.
 */
export function listStateMapConfigs(db: Database.Database): Array<{ intent: string; stateName: string }> {
  try {
    const settings = new SettingsStore(db)
    const entries = settings.getByPrefix(STATE_MAP_PREFIX)
    return entries.map(e => ({
      intent: e.key.slice(STATE_MAP_PREFIX.length),
      stateName: e.value,
    }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// State Fetching — Provider Adapters
// ---------------------------------------------------------------------------

/**
 * Create a PMProvider adapter from the existing TicketProvider + ProviderStorage.
 *
 * Fetches fresh states from the project's board via storage, and delegates
 * moveTicket to the TicketProvider (which routes to Linear/Jira/PMO).
 */
export function createPMProviderAdapter(
  provider: TicketProvider,
  storage: ProviderStorage,
  projectId: string,
): PMProvider {
  return {
    async fetchStates(_ticketId: string): Promise<PMState[]> {
      const board = await storage.getProjectBoard(projectId)
      if (!board) return []
      return board.columns.map((col, idx) => ({
        id: col.name,  // For PMO, the state ID is the column name
        name: col.name,
      }))
    },

    async moveTicket(ticketId: string, stateId: string) {
      const result = await provider.moveTicket(ticketId, stateId)
      return { success: result.success, error: result.error }
    },
  }
}

// ---------------------------------------------------------------------------
// Core: move()
// ---------------------------------------------------------------------------

/**
 * Options for the move() function.
 */
export interface MoveOptions {
  /** Database for config lookups (optional — skip config check if not provided) */
  db?: Database.Database
  /** Current state name — if provided, skip move when already in the resolved state */
  currentState?: string
}

/**
 * Move a ticket to a state matching a semantic intent.
 *
 * Resolution order:
 * 1. Fetch fresh states from the provider (never cache)
 * 2. Check user config for `state-map.{intent}` override → exact match
 * 3. Match against built-in semantic intent aliases
 * 4. LLM fallback — ask Claude which state matches the intent
 * 5. No match → skip, return warning
 *
 * @param pmProvider - The PM provider to fetch states from and move tickets in
 * @param ticketId - The ticket to move
 * @param intent - The semantic intent (e.g., 'review', 'active', 'done', 'blocked')
 * @param dbOrOptions - Database instance or options object
 * @returns Resolution result with success/failure and metadata
 */
export async function move(
  pmProvider: PMProvider,
  ticketId: string,
  intent: string,
  dbOrOptions?: Database.Database | MoveOptions,
): Promise<StateResolutionResult> {
  // Normalize arguments: support both `move(p, id, intent, db)` and `move(p, id, intent, { db, currentState })`
  let db: Database.Database | undefined
  let currentState: string | undefined
  if (dbOrOptions && typeof dbOrOptions === 'object' && 'prepare' in dbOrOptions) {
    // It's a Database instance (has .prepare method)
    db = dbOrOptions as Database.Database
  } else if (dbOrOptions && typeof dbOrOptions === 'object') {
    const opts = dbOrOptions as MoveOptions
    db = opts.db
    currentState = opts.currentState
  }
  // 1. Always fetch fresh states
  let states: PMState[]
  try {
    states = await pmProvider.fetchStates(ticketId)
  } catch (error) {
    return {
      success: false,
      error: `Failed to fetch states: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (states.length === 0) {
    return {
      success: false,
      error: 'No states available from provider',
    }
  }

  // Helper: check if ticket is already in the resolved state (case-insensitive)
  const isAlreadyInState = (stateName: string): boolean => {
    if (!currentState) return false
    return currentState.toLowerCase() === stateName.toLowerCase()
  }

  // 2. Check user config override
  if (db) {
    const configOverride = getStateMapConfig(db, intent)
    if (configOverride) {
      const match = states.find(s => s.name.toLowerCase() === configOverride.toLowerCase())
      if (match) {
        if (isAlreadyInState(match.name)) {
          return { success: false, resolvedVia: 'config', stateName: match.name, stateId: match.id }
        }
        const result = await pmProvider.moveTicket(ticketId, match.id)
        return {
          success: result.success,
          resolvedVia: 'config',
          stateName: match.name,
          stateId: match.id,
          error: result.error,
        }
      }
      // Config is set but no matching state — fall through to alias/LLM
    }
  }

  // 3. Match against built-in semantic intent aliases
  const intentDef = getDefaultIntent(intent)
  if (intentDef) {
    const aliasMatch = matchIntentByAliases(states, intentDef)
    if (aliasMatch) {
      if (isAlreadyInState(aliasMatch.name)) {
        return { success: false, resolvedVia: 'alias', stateName: aliasMatch.name, stateId: aliasMatch.id }
      }
      const result = await pmProvider.moveTicket(ticketId, aliasMatch.id)
      return {
        success: result.success,
        resolvedVia: 'alias',
        stateName: aliasMatch.name,
        stateId: aliasMatch.id,
        error: result.error,
      }
    }
  }

  // 4. LLM fallback
  const llmMatch = await llmResolveState(states, intent)
  if (llmMatch) {
    if (isAlreadyInState(llmMatch.name)) {
      return { success: false, resolvedVia: 'llm', stateName: llmMatch.name, stateId: llmMatch.id }
    }
    const result = await pmProvider.moveTicket(ticketId, llmMatch.id)
    return {
      success: result.success,
      resolvedVia: 'llm',
      stateName: llmMatch.name,
      stateId: llmMatch.id,
      error: result.error,
    }
  }

  // 5. No match — skip
  const warning = `No state match for intent '${intent}', skipping move`
  console.warn(warning)
  return {
    success: false,
    resolvedVia: 'skipped',
    warning,
  }
}

// ---------------------------------------------------------------------------
// Convenience: moveWithProvider()
// ---------------------------------------------------------------------------

/**
 * High-level convenience function that wraps move() with the existing
 * TicketProvider + ProviderStorage infrastructure.
 *
 * Use this from commands and lifecycle hooks that already have a resolved
 * TicketProvider and ProviderStorage.
 */
export async function moveWithProvider(
  provider: TicketProvider,
  storage: ProviderStorage,
  projectId: string,
  ticketId: string,
  intent: string,
  db?: Database.Database,
  currentState?: string,
): Promise<StateResolutionResult> {
  const pmProvider = createPMProviderAdapter(provider, storage, projectId)
  return move(pmProvider, ticketId, intent, { db, currentState })
}
