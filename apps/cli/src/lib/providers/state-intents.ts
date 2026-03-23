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
 * Default semantic intents shipped with the CLI.
 *
 * Order matters: when matching, the first alias match wins.
 * Aliases are matched case-insensitively.
 */
export const DEFAULT_INTENTS: SemanticIntent[] = [
  {
    name: 'active',
    description: 'Work has started',
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
    name: 'review',
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
    name: 'done',
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
    name: 'blocked',
    description: 'Work is stuck',
    aliases: [
      'Blocked',
      'On Hold',
      'Stuck',
      'Waiting',
      'Paused',
      'Impediment',
      'Pending',
    ],
  },
]

/**
 * Get a default intent by name.
 */
export function getDefaultIntent(name: string): SemanticIntent | undefined {
  return DEFAULT_INTENTS.find(i => i.name === name)
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
