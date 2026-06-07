import { tildifyPath, type UnifiedSession } from '../session/renderer.js'

/**
 * Render a one-line summary of available orchestrator sessions for use in
 * "name not found" error messages.
 *
 * Each entry is "<agentName> (<hqPath-or-host>)" joined by ", ".
 */
export function formatAvailableSessions(sessions: UnifiedSession[]): string {
  if (sessions.length === 0) return '(none)'
  return sessions
    .map(s => {
      const location = s.hqPath ? tildifyPath(s.hqPath) : 'host'
      const tag = s.environment === 'container' ? ', Docker' : ''
      return `${s.agentName} (${location}${tag})`
    })
    .join(', ')
}
