/**
 * Semantic Intent Presets
 *
 * Default mappings from semantic intents (what you want to express)
 * to common state names across PM tools. Used as a local fallback
 * before reaching for the LLM resolver.
 *
 * These cover the most common workflow states across Linear, Trello,
 * ClickUp, Jira, Shortcut, Asana, and custom PMO boards.
 */

/**
 * A semantic intent represents a stage in the ticket lifecycle.
 * Each intent maps to common state names in popular PM tools.
 */
export interface SemanticIntent {
  /** The intent name (e.g., 'active', 'review') */
  name: string
  /** Human-readable description */
  description: string
  /** Common state names that match this intent (case-insensitive) */
  aliases: string[]
}

/**
 * Transition intents — the canonical set of intents used by work commands.
 *
 * Each work primitive maps to exactly one transition intent:
 *   work start  → started
 *   work ready  → needs_review
 *   work ship   → completed
 *   work stop   → paused
 *   work groom  → ready
 *   work drop   → dropped
 *
 * These are the intents stored in the pmo_transition_map table.
 */
export type TransitionIntent = 'backlog' | 'started' | 'needs_review' | 'completed' | 'paused' | 'ready' | 'dropped'

export const TRANSITION_INTENTS: TransitionIntent[] = [
  'backlog',
  'started',
  'needs_review',
  'completed',
  'paused',
  'ready',
  'dropped',
]

/**
 * Default semantic intents shipped with the CLI.
 *
 * Order matters: when matching, the first alias match wins.
 * Aliases are matched case-insensitively.
 *
 * The `name` field uses the canonical transition intent names where applicable.
 * Legacy names ('active', 'review', 'done', 'blocked') are kept as aliases
 * within the new intents for backward compatibility.
 */
export const DEFAULT_INTENTS: SemanticIntent[] = [
  {
    name: 'backlog',
    description: 'Not yet scheduled for work',
    aliases: [
      'Backlog',
      'Icebox',
      'Inbox',
      'Triage',
      'Unscheduled',
      'Later',
      'Someday',
    ],
  },
  {
    name: 'started',
    description: 'Work has begun',
    aliases: [
      'In Progress',
      'Working On',
      'Doing',
      'In Development',
      'Started',
      'Active',
      'Developing',
      'In Work',
    ],
  },
  {
    name: 'needs_review',
    description: 'Work is done, awaiting review',
    aliases: [
      'Review',
      'In Review',
      'Needs Review',
      'Awaiting Review',
      'Awaiting Feedback',
      'Code Review',
      'QA',
      'Ready for Review',
      'Pending Review',
    ],
  },
  {
    name: 'completed',
    description: 'Work is complete',
    aliases: [
      'Done',
      'Complete',
      'Closed',
      'Shipped',
      'Merged',
      'Resolved',
      'Finished',
      'Released',
    ],
  },
  {
    name: 'paused',
    description: 'Work is stopped temporarily',
    aliases: [
      'Blocked',
      'On Hold',
      'Stuck',
      'Waiting',
      'Paused',
      'Not Working On',
      'Impediment',
      'Pending',
    ],
  },
  {
    name: 'ready',
    description: 'Groomed and ready to start',
    aliases: [
      'Ready',
      'Ready for Development',
      'Development Ready',
      'Planned',
      'Groomed',
      'To Do',
      'Todo',
      'Selected for Development',
      'Up Next',
    ],
  },
  {
    name: 'dropped',
    description: 'Removed from active work entirely',
    aliases: [
      'Canceled',
      'Cancelled',
      'Won\'t Do',
      'Won\'t Fix',
      'Archived',
      'Removed',
      'Dropped',
      'Discarded',
    ],
  },
]

/**
 * Map from legacy intent names to the new canonical transition intent names.
 * Used for backward compatibility with existing state-map config overrides.
 */
const LEGACY_INTENT_MAP: Record<string, string> = {
  active: 'started',
  review: 'needs_review',
  done: 'completed',
  blocked: 'paused',
}

/**
 * Get a default intent by name.
 * Also resolves legacy intent names (active → started, review → needs_review, etc.)
 */
export function getDefaultIntent(name: string): SemanticIntent | undefined {
  const resolved = LEGACY_INTENT_MAP[name] ?? name
  return DEFAULT_INTENTS.find(i => i.name === resolved)
}

/**
 * Try to match a state name against intent aliases (case-insensitive).
 * Returns the matched state name from the available states, or null.
 */
export function matchIntentByAliases(
  availableStates: Array<{ id: string; name: string }>,
  intent: SemanticIntent,
): { id: string; name: string } | null {
  const lowerAliases = intent.aliases.map(a => a.toLowerCase())

  for (const alias of lowerAliases) {
    const match = availableStates.find(s => s.name.toLowerCase() === alias)
    if (match) return match
  }

  // Partial match: check if any state name contains an alias or vice versa
  for (const alias of lowerAliases) {
    const match = availableStates.find(s =>
      s.name.toLowerCase().includes(alias) ||
      alias.includes(s.name.toLowerCase()),
    )
    if (match) return match
  }

  return null
}
