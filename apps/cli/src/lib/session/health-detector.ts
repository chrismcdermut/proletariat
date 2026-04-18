/**
 * Health Detector — shared agent health state detection from tmux pane content.
 *
 * Extracted from commands/session/health.ts for reuse by SimplePoller
 * and any other code that needs to classify agent health states.
 */

// =============================================================================
// Types
// =============================================================================

export type AgentHealthState = 'HUNG' | 'WORKING' | 'DONE' | 'IDLE' | 'UNKNOWN'

// =============================================================================
// Detection Logic
// =============================================================================

/**
 * Detect agent health state from tmux pane content.
 *
 * Detection patterns (checked in priority order):
 * - '0 tokens' (the down-arrow + 0 tokens pattern) = HUNG
 * - 'esc to interrupt' = WORKING
 * - 'Agent work complete' or similar completion messages = DONE
 * - Idle prompt patterns ($ or ❯ at end of line) = IDLE
 */
export function detectState(paneContent: string | null): AgentHealthState {
  if (!paneContent) return 'UNKNOWN'

  // Check last few lines for patterns
  const lines = paneContent.split('\n')
  const lastLines = lines.slice(-10).join('\n')

  // HUNG: stuck API call showing '0 tokens' (the ↓ 0 tokens pattern)
  if (/0 tokens/.test(lastLines)) {
    return 'HUNG'
  }

  // WORKING: agent is actively processing
  if (/esc to interrupt/i.test(lastLines)) {
    return 'WORKING'
  }

  // DONE: agent work is complete
  if (/agent work complete/i.test(lastLines) || /work ready/i.test(lastLines)) {
    return 'DONE'
  }

  // IDLE: shell prompt visible (agent has finished or is waiting)
  // Match common prompt patterns at end of last non-empty line
  const lastNonEmpty = [...lines].reverse().find((l: string) => l.trim().length > 0) || ''
  if (/[$❯#>]\s*$/.test(lastNonEmpty) || /^\s*\$\s*$/.test(lastNonEmpty)) {
    return 'IDLE'
  }

  return 'UNKNOWN'
}

// =============================================================================
// Aggregation
// =============================================================================

/** Counts of agents in each health state. */
export interface AgentHealthCounts {
  total: number
  working: number
  idle: number
  hung: number
  done: number
  unknown: number
}

/** Compute counts from a list of health states. */
export function countByState(states: AgentHealthState[]): AgentHealthCounts {
  const counts: AgentHealthCounts = { total: states.length, working: 0, idle: 0, hung: 0, done: 0, unknown: 0 }
  for (const s of states) {
    switch (s) {
      case 'WORKING': counts.working++; break
      case 'IDLE': counts.idle++; break
      case 'HUNG': counts.hung++; break
      case 'DONE': counts.done++; break
      case 'UNKNOWN': counts.unknown++; break
    }
  }
  return counts
}

/**
 * Format health counts into a compact summary string.
 * Example: "3 working, 47 idle, 0 hung"
 */
export function formatHealthSummary(counts: AgentHealthCounts): string {
  const parts: string[] = []
  if (counts.working > 0) parts.push(`${counts.working} working`)
  if (counts.hung > 0) parts.push(`${counts.hung} hung`)
  if (counts.idle > 0) parts.push(`${counts.idle} idle`)
  if (counts.done > 0) parts.push(`${counts.done} done`)
  if (counts.unknown > 0) parts.push(`${counts.unknown} unknown`)
  return parts.length > 0 ? parts.join(', ') : '0 agents'
}
