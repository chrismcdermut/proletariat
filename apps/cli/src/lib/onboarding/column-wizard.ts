/**
 * Column Mapping Wizard
 *
 * Interactive wizard that auto-maps board columns to prlt's abstract intents
 * during onboarding (prlt init, prlt connect). Handles:
 *
 * 1. Auto-matching obvious columns via fuzzy string matching
 * 2. Asking about ambiguous columns (e.g., "Closed" → completed or dropped?)
 * 3. Asking about unmapped columns (map to intent, create custom, or skip)
 * 4. Many-to-one mapping (multiple columns → same intent)
 * 5. Suggesting custom actions for non-standard columns
 * 6. JSON mode for AI agent interaction
 */

import inquirer from 'inquirer'
import type Database from 'better-sqlite3'
import { colors } from '../colors.js'
import {
  type BoardState,
  type IntentMapping,
  autoMapWithDisambiguation,
  formatMappingTable,
  suggestCustomActions,
} from '../providers/auto-mapper.js'
import { TRANSITION_INTENTS, type TransitionIntent } from '../providers/state-intents.js'
import { TransitionMapStore } from '../providers/transition-map.js'

export type ProviderType = 'linear' | 'jira' | 'trello' | 'asana' | 'shortcut' | 'clickup' | 'github' | 'pmo'

export interface ColumnWizardOptions {
  states: BoardState[]
  provider: string
  providerType: ProviderType
  db: Database.Database
  jsonMode: boolean
  log: (msg: string) => void
}

export interface WizardResult {
  mappings: IntentMapping[]
  saved: boolean
  suggestions: string[]
}

/**
 * Run the column mapping wizard.
 *
 * Flow:
 * 1. Auto-map columns using heuristics
 * 2. Show mapping table for user confirmation
 * 3. Disambiguate ambiguous states
 * 4. Handle unmapped states
 * 5. Save to transition map
 * 6. Suggest custom actions
 */
export async function runColumnWizard(opts: ColumnWizardOptions): Promise<WizardResult> {
  const { states, provider, providerType, db, jsonMode, log } = opts

  if (states.length === 0) {
    return { mappings: [], saved: false, suggestions: [] }
  }

  // Step 1: Auto-map with disambiguation
  const { mappings, ambiguous, unmapped } = autoMapWithDisambiguation(states, providerType)

  // Step 2: Handle JSON mode — auto-save and return
  if (jsonMode) {
    return handleJsonMode(mappings, ambiguous, unmapped, provider, db)
  }

  // Step 3: Show mapping table
  log('')
  log(colors.primary('Board Column Mapping'))
  log('')

  if (mappings.length > 0) {
    const lines = formatMappingTable(mappings, states)
    for (const line of lines) {
      log(colors.textMuted(`  ${line}`))
    }
    log('')
  }

  // Step 4: Handle few-column boards
  if (states.length <= 3) {
    log(colors.textMuted(`  Your board has ${states.length} columns. Multiple intents will share columns.`))
    log('')
  }

  // Step 5: Disambiguate ambiguous states
  const resolvedAmbiguous = await disambiguateStates(ambiguous, log)
  mappings.push(...resolvedAmbiguous)

  // Step 6: Handle unmapped states
  const resolvedUnmapped = await handleUnmappedStates(unmapped, mappings, log)
  mappings.push(...resolvedUnmapped)

  // Step 7: Confirm and save
  const saved = await confirmAndSave(mappings, provider, db, log)

  // Step 8: Suggest custom actions
  const suggestions = suggestCustomActions(mappings)
  if (suggestions.length > 0) {
    log('')
    log(colors.primary('Suggested Actions'))
    for (const suggestion of suggestions) {
      log(colors.textMuted(`  ${suggestion}`))
    }
  }

  return { mappings, saved, suggestions }
}

/**
 * Handle JSON mode: auto-save mappings and return structured result.
 */
function handleJsonMode(
  mappings: IntentMapping[],
  ambiguous: Array<{ state: BoardState; candidateIntents: Array<{ intent: string; reason: string }> }>,
  _unmapped: BoardState[],
  provider: string,
  db: Database.Database,
): WizardResult {
  // In JSON mode, resolve ambiguous states with first candidate
  for (const amb of ambiguous) {
    if (amb.candidateIntents.length > 0) {
      mappings.push({
        intent: amb.candidateIntents[0].intent as TransitionIntent,
        stateName: amb.state.name,
        stateId: amb.state.id,
        confidence: 'none',
      })
    }
  }

  // Save all mappings
  const store = new TransitionMapStore(db)
  store.clearMappings(provider)
  for (const m of mappings) {
    store.upsertMapping({
      provider,
      intent: m.intent as TransitionIntent,
      providerStateName: m.stateName,
      providerStateId: m.stateId,
    })
  }

  const suggestions = suggestCustomActions(mappings)
  return { mappings, saved: true, suggestions }
}

/**
 * Ask the user to disambiguate ambiguous states.
 */
async function disambiguateStates(
  ambiguous: Array<{ state: BoardState; candidateIntents: Array<{ intent: string; reason: string }> }>,
  log: (msg: string) => void,
): Promise<IntentMapping[]> {
  const resolved: IntentMapping[] = []

  for (const { state, candidateIntents } of ambiguous) {
    log(colors.warning(`  "${state.name}" is ambiguous — what does it mean for your team?`))

    const choices = [
      ...candidateIntents.map(c => ({
        name: `${c.intent} — ${c.reason}`,
        value: c.intent,
      })),
      { name: 'Skip — don\'t map this column', value: '__skip__' },
    ]
    const message = `What does "${state.name}" mean?`

    const { selectedIntent } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedIntent',
      message,
      choices,
    }])

    if (selectedIntent !== '__skip__') {
      resolved.push({
        intent: selectedIntent as TransitionIntent,
        stateName: state.name,
        stateId: state.id,
        confidence: 'none',
      })
    }
  }

  return resolved
}

/**
 * Ask the user what to do with unmapped states.
 */
async function handleUnmappedStates(
  unmapped: BoardState[],
  existingMappings: IntentMapping[],
  log: (msg: string) => void,
): Promise<IntentMapping[]> {
  const resolved: IntentMapping[] = []

  if (unmapped.length === 0) return resolved

  log(colors.textMuted(`  ${unmapped.length} column(s) not auto-mapped:`))
  for (const state of unmapped) {
    log(colors.textMuted(`    - ${state.name}`))
  }
  log('')

  for (const state of unmapped) {
    // Build choices: existing intents + custom + skip
    const mappedIntents = new Set(existingMappings.map(m => m.intent))
    const allIntents = [...TRANSITION_INTENTS, 'testing', 'rework', 'blocked']

    const choices = [
      ...allIntents.map(intent => ({
        name: `${intent}${mappedIntents.has(intent) ? ' (already mapped)' : ''}`,
        value: intent,
      })),
      { name: 'Skip — don\'t map this column', value: '__skip__' },
    ]
    const message = `Map "${state.name}" to which intent?`

    const { selectedIntent } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedIntent',
      message,
      choices,
    }])

    if (selectedIntent !== '__skip__') {
      resolved.push({
        intent: selectedIntent as TransitionIntent,
        stateName: state.name,
        stateId: state.id,
        confidence: 'none',
      })
    }
  }

  return resolved
}

/**
 * Ask the user to confirm the mapping and save it.
 */
async function confirmAndSave(
  mappings: IntentMapping[],
  provider: string,
  db: Database.Database,
  log: (msg: string) => void,
): Promise<boolean> {
  if (mappings.length === 0) {
    log(colors.textMuted('  No mappings to save.'))
    return false
  }

  const choices = [
    { name: 'Yes, save these mappings', value: true },
    { name: 'No, skip mapping for now', value: false },
  ]
  const message = `Save ${mappings.length} state mapping(s)?`

  const { confirmed } = await inquirer.prompt([{
    type: 'list',
    name: 'confirmed',
    message,
    choices,
  }])

  if (confirmed) {
    const store = new TransitionMapStore(db)
    store.clearMappings(provider)
    for (const m of mappings) {
      store.upsertMapping({
        provider,
        intent: m.intent as TransitionIntent,
        providerStateName: m.stateName,
        providerStateId: m.stateId,
      })
    }
    log(colors.success(`  Saved ${mappings.length} state mapping(s)`))
    return true
  }

  log(colors.textMuted('  Skipped state mapping. Configure later with "prlt config set state-map.<intent> <state-name>"'))
  return false
}
