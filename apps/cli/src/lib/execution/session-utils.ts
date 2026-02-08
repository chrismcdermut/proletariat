/**
 * Session Utilities
 *
 * Shared utilities for tmux session naming, parsing, and discovery.
 * Used by session/list.ts and session/attach.ts commands.
 */

import { execSync } from 'node:child_process'

/**
 * Known action names used in session naming.
 * These are the actions defined in pmo/actions/ that may be used when spawning agents.
 */
export const KNOWN_ACTIONS = [
  'Implement',
  'Review',
  'Fix',
  'Refactor',
  'Test',
  'Document',
  'work',  // Default fallback
] as const

/**
 * Parse a tmux session name following prlt naming convention.
 * Format: {ticketId}-{action}-{agentName}
 *
 * Note: Agent names can contain hyphens (like "stout-page"), so we match
 * from the end using known action names to correctly split the components.
 *
 * Example: "TKT-878-Implement-stout-page" -> { ticketId: "TKT-878", action: "Implement", agentName: "stout-page" }
 */
export function parseSessionName(sessionName: string): { ticketId: string; action: string; agentName: string } | null {
  // First, extract the ticket ID (format: TKT-### or PROJECT-###)
  const ticketMatch = sessionName.match(/^(TKT-\d+|[A-Z]+-\d+)-/)
  if (!ticketMatch) {
    return null
  }

  const ticketId = ticketMatch[1]
  const remainder = sessionName.slice(ticketMatch[0].length)

  // Try to match known actions (case-insensitive) at the start of the remainder
  for (const action of KNOWN_ACTIONS) {
    const actionLower = action.toLowerCase()
    const remainderLower = remainder.toLowerCase()

    // Check if remainder starts with this action followed by a hyphen
    if (remainderLower.startsWith(actionLower + '-')) {
      const agentName = remainder.slice(action.length + 1)
      if (agentName) {
        return {
          ticketId,
          action: remainder.slice(0, action.length),  // Preserve original casing
          agentName,
        }
      }
    }
  }

  // Fallback: Split on first hyphen (original behavior for unknown actions)
  const parts = remainder.split('-')
  if (parts.length >= 2) {
    return {
      ticketId,
      action: parts[0],
      agentName: parts.slice(1).join('-'),
    }
  }

  return null
}

/**
 * Build expected session name from execution data.
 * Format: {ticketId}-{action}-{agentName}
 * This is the same format used by runners.ts buildSessionName()
 */
export function buildExpectedSessionName(ticketId: string, agentName: string, action: string = 'work'): string {
  return `${ticketId}-${action}-${agentName}`
}

/**
 * Check if a session name matches the expected pattern for a ticket and agent.
 * Verifies both the ticket ID prefix and agent name suffix.
 */
export function sessionMatchesExecution(sessionName: string, ticketId: string, agentName: string): boolean {
  return sessionName.startsWith(`${ticketId}-`) && sessionName.endsWith(`-${agentName}`)
}

/**
 * Get list of host tmux session names.
 */
export function getHostTmuxSessionNames(): string[] {
  try {
    execSync('which tmux', { stdio: 'pipe' })
    const output = execSync(
      'tmux list-sessions -F "#{session_name}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (!output) return []
    return output.split('\n')
  } catch {
    return []
  }
}

/**
 * Get map of containerId -> tmux session names.
 * Only checks containers with the devcontainer.local_folder label.
 */
export function getContainerTmuxSessionMap(): Map<string, string[]> {
  const sessionMap = new Map<string, string[]>()

  try {
    const containersOutput = execSync(
      'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    if (!containersOutput) return sessionMap

    for (const containerId of containersOutput.split('\n')) {
      try {
        const tmuxOutput = execSync(
          `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()

        if (tmuxOutput) {
          sessionMap.set(containerId, tmuxOutput.split('\n'))
        }
      } catch {
        // Container has no tmux sessions
      }
    }
  } catch {
    // Docker not available
  }

  return sessionMap
}

/**
 * Flatten container sessions map into an array for easier iteration.
 */
export function flattenContainerSessions(
  containerTmuxSessions: Map<string, string[]>
): Array<{ sessionName: string; containerId: string }> {
  const result: Array<{ sessionName: string; containerId: string }> = []
  containerTmuxSessions.forEach((sessions, containerId) => {
    for (const sessionName of sessions) {
      result.push({ sessionName, containerId })
    }
  })
  return result
}

/**
 * Try to find a matching tmux session for an execution with NULL sessionId.
 * First tries exact matches with known action names, then falls back to
 * partial matching with agent name verification.
 *
 * @returns The matched session name, or null if no match found
 */
export function findSessionForExecution(
  ticketId: string,
  agentName: string,
  availableSessions: string[]
): string | null {
  // First, try exact matches with known action names
  for (const action of KNOWN_ACTIONS) {
    const expectedName = buildExpectedSessionName(ticketId, agentName, action)
    if (availableSessions.includes(expectedName)) {
      return expectedName
    }
    // Also try lowercase variant
    const expectedNameLower = buildExpectedSessionName(ticketId, agentName, action.toLowerCase())
    if (availableSessions.includes(expectedNameLower)) {
      return expectedNameLower
    }
  }

  // Fallback: partial match with agent name verification
  // This catches sessions with unknown action names while preventing
  // false matches when multiple agents work on the same ticket
  const match = availableSessions.find(s => sessionMatchesExecution(s, ticketId, agentName))
  return match || null
}
