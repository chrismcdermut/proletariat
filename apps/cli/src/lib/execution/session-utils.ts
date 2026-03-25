/**
 * Session Utilities
 *
 * Shared utilities for tmux session naming, parsing, and discovery.
 * Used by session/list.ts, session/attach.ts, session/health.ts, and session/peek.ts commands.
 */

import { execSync, execFileSync } from 'node:child_process'

/**
 * Capture the last N lines from a tmux pane.
 * Supports both host tmux sessions and container tmux sessions (via docker exec).
 *
 * @param sessionId - The tmux session ID to capture from
 * @param lines - Number of scrollback lines to capture
 * @param containerId - Optional container ID for container-based sessions
 * @returns The captured pane content, or null if capture fails
 */
export function captureTmuxPane(sessionId: string, lines: number, containerId?: string): string | null {
  try {
    const args = ['capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`]
    if (containerId) {
      return execFileSync('docker', ['exec', containerId, 'tmux', ...args], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      }).trim()
    }
    return execFileSync('tmux', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

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
 * Parses the session name and verifies the ticket ID and agent name match exactly.
 */
export function sessionMatchesExecution(sessionName: string, ticketId: string, agentName: string): boolean {
  const parsed = parseSessionName(sessionName)
  if (!parsed) return false
  return parsed.ticketId === ticketId && parsed.agentName === agentName
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
    const containerIds = new Set<string>()

    // Primary: devcontainer-labeled containers (historical behavior).
    try {
      const labeledOutput = execSync(
        'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      if (labeledOutput) {
        for (const id of labeledOutput.split('\n')) {
          if (id.trim()) containerIds.add(id.trim())
        }
      }
    } catch {
      // Ignore and continue with broad fallback discovery.
    }

    // Fallback: include all running containers so prlt-managed devcontainers
    // without the devcontainer.local_folder label are still discoverable.
    try {
      const allOutput = execSync(
        'docker ps --format "{{.ID}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      if (allOutput) {
        for (const id of allOutput.split('\n')) {
          if (id.trim()) containerIds.add(id.trim())
        }
      }
    } catch {
      // Docker not available.
    }

    if (containerIds.size === 0) return sessionMap

    for (const containerId of containerIds) {
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
 * Find container sessions using prefix matching.
 * Handles short vs full container ID mismatches between DB records and docker output.
 */
export function findContainerSessionsByPrefix(
  containerTmuxSessions: Map<string, string[]>,
  containerId: string
): string[] {
  const exact = containerTmuxSessions.get(containerId)
  if (exact) return exact

  for (const [key, sessions] of containerTmuxSessions) {
    if (key.startsWith(containerId) || containerId.startsWith(key)) {
      return sessions
    }
  }

  return []
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

/**
 * Send a text message to a tmux session via send-keys.
 * Sends the text first, then Enter separately with a small delay
 * to avoid race conditions where Enter arrives before text is rendered.
 *
 * Uses execFileSync (no shell) to pass the message directly to tmux
 * as an argv argument, avoiding all shell escaping issues with
 * parentheses, quotes, newlines, dollar signs, backticks, etc.
 */
export function sendTmuxMessage(sessionId: string, message: string, containerId?: string): void {
  // Argument arrays for each tmux command — passed directly via execFileSync
  // to bypass shell interpretation entirely.
  const escapeArgs = ['send-keys', '-t', sessionId, 'Escape']
  const textArgs = ['send-keys', '-l', '-t', sessionId, message]
  const enterArgs = ['send-keys', '-t', sessionId, 'Enter']

  if (containerId) {
    // Clear any buffered input first
    execFileSync('docker', ['exec', containerId, 'tmux', ...escapeArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    // Wait for Escape to take effect before sending new text
    execSync('sleep 0.2', { stdio: ['pipe', 'pipe', 'pipe'] })
    // Send the text literally — execFileSync bypasses shell, so the message
    // reaches tmux verbatim regardless of content (parens, quotes, newlines, etc.)
    execFileSync('docker', ['exec', containerId, 'tmux', ...textArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    // Small delay before sending Enter to avoid race conditions
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execFileSync('docker', ['exec', containerId, 'tmux', ...enterArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
  } else {
    // Clear any buffered input first
    execFileSync('tmux', escapeArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    // Wait for Escape to take effect before sending new text
    execSync('sleep 0.2', { stdio: ['pipe', 'pipe', 'pipe'] })
    execFileSync('tmux', textArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    // Small delay before sending Enter
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execFileSync('tmux', enterArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
  }
}
