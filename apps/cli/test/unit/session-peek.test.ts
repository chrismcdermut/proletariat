import { expect } from 'chai'

/**
 * Unit tests for session peek target resolution logic.
 *
 * Tests the target resolution algorithm used by `prlt session peek` to
 * resolve agent name, ticket ID, execution ID, or session ID to
 * matching verified sessions.
 */

interface VerifiedSession {
  sessionId: string
  ticketId: string
  agentName: string
  environment: 'host' | 'container'
  containerId?: string
  source: 'db' | 'discovered'
}

/**
 * Replicate the resolveTarget logic from peek.ts for unit testing.
 * This is the pure-function core that doesn't depend on DB or tmux.
 */
function resolveTarget(target: string, sessions: VerifiedSession[]): VerifiedSession[] {
  // Try exact session ID match
  const exactSession = sessions.filter(s => s.sessionId === target)
  if (exactSession.length > 0) return exactSession

  // Try ticket ID match (e.g. TKT-123)
  if (/^[A-Z]+-\d+$/i.test(target)) {
    const ticketTarget = target.toUpperCase()
    const ticketMatches = sessions.filter(s => s.ticketId === ticketTarget)
    if (ticketMatches.length > 0) return ticketMatches
  }

  // Try agent name match
  const agentMatches = sessions.filter(s => s.agentName === target)
  if (agentMatches.length > 0) return agentMatches

  // Try partial match
  const partialMatches = sessions.filter(s =>
    s.sessionId.includes(target) ||
    s.ticketId.includes(target.toUpperCase()) ||
    s.agentName.includes(target)
  )
  return partialMatches
}

describe('Session Peek Target Resolution', () => {
  const sessions: VerifiedSession[] = [
    {
      sessionId: 'TKT-100-Implement-altman',
      ticketId: 'TKT-100',
      agentName: 'altman',
      environment: 'host',
      source: 'db',
    },
    {
      sessionId: 'TKT-100-Review-bezos',
      ticketId: 'TKT-100',
      agentName: 'bezos',
      environment: 'container',
      containerId: 'abc123',
      source: 'db',
    },
    {
      sessionId: 'TKT-200-Implement-gates',
      ticketId: 'TKT-200',
      agentName: 'gates',
      environment: 'host',
      source: 'discovered',
    },
    {
      sessionId: 'TKT-300-work-stout-page',
      ticketId: 'TKT-300',
      agentName: 'stout-page',
      environment: 'host',
      source: 'db',
    },
  ]

  describe('exact session ID match', () => {
    it('should match exact session ID', () => {
      const result = resolveTarget('TKT-100-Implement-altman', sessions)
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('altman')
    })

    it('should match exact session ID with hyphenated agent', () => {
      const result = resolveTarget('TKT-300-work-stout-page', sessions)
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('stout-page')
    })
  })

  describe('ticket ID match', () => {
    it('should match by ticket ID and return all sessions for that ticket', () => {
      const result = resolveTarget('TKT-100', sessions)
      expect(result).to.have.length(2)
      expect(result.map(s => s.agentName)).to.include.members(['altman', 'bezos'])
    })

    it('should match ticket ID case-insensitively', () => {
      const result = resolveTarget('tkt-200', sessions)
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('gates')
    })

    it('should return empty for non-existent ticket', () => {
      const result = resolveTarget('TKT-999', sessions)
      expect(result).to.have.length(0)
    })
  })

  describe('agent name match', () => {
    it('should match by agent name', () => {
      const result = resolveTarget('altman', sessions)
      expect(result).to.have.length(1)
      expect(result[0].ticketId).to.equal('TKT-100')
    })

    it('should match hyphenated agent name', () => {
      const result = resolveTarget('stout-page', sessions)
      expect(result).to.have.length(1)
      expect(result[0].ticketId).to.equal('TKT-300')
    })

    it('should not match partial agent name as exact', () => {
      // "stout" is not an agent name; only "stout-page" is
      const result = resolveTarget('stout', sessions)
      // Should still find via partial matching
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('stout-page')
    })
  })

  describe('partial match fallback', () => {
    it('should match partial session ID', () => {
      const result = resolveTarget('Implement-gates', sessions)
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('gates')
    })

    it('should return empty for no match', () => {
      const result = resolveTarget('nonexistent', sessions)
      expect(result).to.have.length(0)
    })
  })

  describe('priority ordering', () => {
    it('should prefer exact session ID over ticket ID', () => {
      // Create a session whose ID looks like a ticket ID pattern
      const specialSessions: VerifiedSession[] = [
        ...sessions,
        {
          sessionId: 'TKT-100',
          ticketId: 'TKT-100',
          agentName: 'special',
          environment: 'host',
          source: 'discovered',
        },
      ]
      const result = resolveTarget('TKT-100', specialSessions)
      // Should match the exact session ID first (1 result), not the ticket (3 results)
      expect(result).to.have.length(1)
      expect(result[0].agentName).to.equal('special')
    })
  })

  describe('empty sessions', () => {
    it('should return empty for any target when no sessions exist', () => {
      expect(resolveTarget('altman', [])).to.have.length(0)
      expect(resolveTarget('TKT-100', [])).to.have.length(0)
    })
  })
})
