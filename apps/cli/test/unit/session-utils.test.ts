import { expect } from 'chai'

import {
  parseSessionName,
  buildExpectedSessionName,
  sessionMatchesExecution,
  findSessionForExecution,
  KNOWN_ACTIONS,
} from '../../src/lib/execution/session-utils.js'

/**
 * Unit tests for session utility functions
 */
describe('Session Utils', () => {
  describe('parseSessionName', () => {
    it('should parse standard session name format', () => {
      const result = parseSessionName('TKT-123-Implement-my-agent')
      expect(result).to.deep.equal({
        ticketId: 'TKT-123',
        action: 'Implement',
        agentName: 'my-agent',
      })
    })

    it('should parse session name with hyphenated agent name', () => {
      const result = parseSessionName('TKT-878-Implement-stout-page')
      expect(result).to.deep.equal({
        ticketId: 'TKT-878',
        action: 'Implement',
        agentName: 'stout-page',
      })
    })

    it('should parse session name with multi-hyphen agent name', () => {
      const result = parseSessionName('TKT-100-Review-very-long-agent-name')
      expect(result).to.deep.equal({
        ticketId: 'TKT-100',
        action: 'Review',
        agentName: 'very-long-agent-name',
      })
    })

    it('should handle lowercase action names', () => {
      const result = parseSessionName('TKT-456-work-test-agent')
      expect(result).to.deep.equal({
        ticketId: 'TKT-456',
        action: 'work',
        agentName: 'test-agent',
      })
    })

    it('should handle different ticket ID formats', () => {
      const result = parseSessionName('PROJ-999-Fix-buggy-bot')
      expect(result).to.deep.equal({
        ticketId: 'PROJ-999',
        action: 'Fix',
        agentName: 'buggy-bot',
      })
    })

    it('should return null for invalid session name (no ticket ID)', () => {
      const result = parseSessionName('invalid-session-name')
      expect(result).to.be.null
    })

    it('should return null for invalid session name (missing components)', () => {
      const result = parseSessionName('TKT-123')
      expect(result).to.be.null
    })

    it('should return null for empty string', () => {
      const result = parseSessionName('')
      expect(result).to.be.null
    })

    it('should handle unknown action names via fallback', () => {
      // Unknown action "CustomAction" should still parse via fallback
      const result = parseSessionName('TKT-123-CustomAction-my-agent')
      expect(result).to.deep.equal({
        ticketId: 'TKT-123',
        action: 'CustomAction',
        agentName: 'my-agent',
      })
    })

    // Edge case from PR review: action names with hyphens
    it('should handle hyphenated action when it matches a known action prefix', () => {
      // If action is "Implement" (known), agent is "multi-part-name"
      const result = parseSessionName('TKT-123-Implement-multi-part-name')
      expect(result).to.deep.equal({
        ticketId: 'TKT-123',
        action: 'Implement',
        agentName: 'multi-part-name',
      })
    })
  })

  describe('buildExpectedSessionName', () => {
    it('should build session name with default action', () => {
      const result = buildExpectedSessionName('TKT-123', 'my-agent')
      expect(result).to.equal('TKT-123-work-my-agent')
    })

    it('should build session name with custom action', () => {
      const result = buildExpectedSessionName('TKT-456', 'test-agent', 'Implement')
      expect(result).to.equal('TKT-456-Implement-test-agent')
    })

    it('should handle hyphenated agent names', () => {
      const result = buildExpectedSessionName('TKT-789', 'stout-page', 'Review')
      expect(result).to.equal('TKT-789-Review-stout-page')
    })
  })

  describe('sessionMatchesExecution', () => {
    it('should match when ticket ID and agent name match', () => {
      const result = sessionMatchesExecution(
        'TKT-123-Implement-my-agent',
        'TKT-123',
        'my-agent'
      )
      expect(result).to.be.true
    })

    it('should match with hyphenated agent name', () => {
      const result = sessionMatchesExecution(
        'TKT-878-Implement-stout-page',
        'TKT-878',
        'stout-page'
      )
      expect(result).to.be.true
    })

    it('should NOT match when ticket ID differs', () => {
      const result = sessionMatchesExecution(
        'TKT-999-Implement-my-agent',
        'TKT-123',
        'my-agent'
      )
      expect(result).to.be.false
    })

    it('should NOT match when agent name differs', () => {
      const result = sessionMatchesExecution(
        'TKT-123-Implement-other-agent',
        'TKT-123',
        'my-agent'
      )
      expect(result).to.be.false
    })

    // Key bug fix: prevent matching wrong agent on same ticket
    it('should NOT match different agent on same ticket', () => {
      // Two agents working on same ticket: agent1 and agent2
      // Session for agent1 should NOT match agent2
      const result = sessionMatchesExecution(
        'TKT-878-Implement-agent1',
        'TKT-878',
        'agent2'
      )
      expect(result).to.be.false
    })

    it('should NOT match when agent name is a substring', () => {
      // "page" is a suffix of "stout-page" but they're different agents
      const result = sessionMatchesExecution(
        'TKT-123-Implement-stout-page',
        'TKT-123',
        'page'
      )
      expect(result).to.be.false
    })
  })

  describe('findSessionForExecution', () => {
    const availableSessions = [
      'TKT-123-Implement-agent1',
      'TKT-123-Review-agent2',
      'TKT-456-work-my-agent',
      'TKT-789-Fix-buggy-bot',
    ]

    it('should find exact match with known action', () => {
      const result = findSessionForExecution('TKT-123', 'agent1', availableSessions)
      expect(result).to.equal('TKT-123-Implement-agent1')
    })

    it('should find exact match with different action', () => {
      const result = findSessionForExecution('TKT-123', 'agent2', availableSessions)
      expect(result).to.equal('TKT-123-Review-agent2')
    })

    it('should find session with default work action', () => {
      const result = findSessionForExecution('TKT-456', 'my-agent', availableSessions)
      expect(result).to.equal('TKT-456-work-my-agent')
    })

    it('should return null when no match found', () => {
      const result = findSessionForExecution('TKT-999', 'nonexistent', availableSessions)
      expect(result).to.be.null
    })

    it('should NOT match wrong agent on same ticket', () => {
      // TKT-123 has agent1 and agent2
      // Looking for agent3 should return null, not match agent1 or agent2
      const result = findSessionForExecution('TKT-123', 'agent3', availableSessions)
      expect(result).to.be.null
    })

    it('should handle empty available sessions', () => {
      const result = findSessionForExecution('TKT-123', 'agent1', [])
      expect(result).to.be.null
    })

    it('should find session with case-insensitive action match', () => {
      const sessions = ['TKT-100-implement-my-agent']
      const result = findSessionForExecution('TKT-100', 'my-agent', sessions)
      expect(result).to.equal('TKT-100-implement-my-agent')
    })

    it('should prefer exact known action match over partial match', () => {
      // If both 'TKT-123-Implement-agent' and 'TKT-123-Custom-agent' exist,
      // and we're looking for 'agent', we should find 'TKT-123-Implement-agent' first
      // because 'Implement' is a known action
      const sessions = [
        'TKT-123-Custom-agent',
        'TKT-123-Implement-agent',
      ]
      const result = findSessionForExecution('TKT-123', 'agent', sessions)
      expect(result).to.equal('TKT-123-Implement-agent')
    })
  })

  describe('KNOWN_ACTIONS', () => {
    it('should include common action names', () => {
      expect(KNOWN_ACTIONS).to.include('Implement')
      expect(KNOWN_ACTIONS).to.include('Review')
      expect(KNOWN_ACTIONS).to.include('Fix')
      expect(KNOWN_ACTIONS).to.include('work')
    })

    it('should be a readonly array', () => {
      // TypeScript enforces this, but we can verify the values exist
      expect(KNOWN_ACTIONS.length).to.be.greaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    describe('multiple agents on same ticket', () => {
      it('should correctly identify each agent session', () => {
        const sessions = [
          'TKT-878-Implement-stout-page',
          'TKT-878-Review-altman',
          'TKT-878-Fix-bezos',
        ]

        // Each agent should find their own session
        expect(findSessionForExecution('TKT-878', 'stout-page', sessions))
          .to.equal('TKT-878-Implement-stout-page')

        expect(findSessionForExecution('TKT-878', 'altman', sessions))
          .to.equal('TKT-878-Review-altman')

        expect(findSessionForExecution('TKT-878', 'bezos', sessions))
          .to.equal('TKT-878-Fix-bezos')
      })

      it('should NOT cross-match agents', () => {
        const sessions = [
          'TKT-878-Implement-stout-page',
          'TKT-878-Review-altman',
        ]

        // Looking for a different agent should return null
        expect(findSessionForExecution('TKT-878', 'gates', sessions))
          .to.be.null
      })
    })

    describe('session name parsing edge cases', () => {
      it('should handle ticket IDs with large numbers', () => {
        const result = parseSessionName('TKT-99999-Implement-agent')
        expect(result?.ticketId).to.equal('TKT-99999')
      })

      it('should handle single-character agent names', () => {
        const result = parseSessionName('TKT-1-work-a')
        expect(result).to.deep.equal({
          ticketId: 'TKT-1',
          action: 'work',
          agentName: 'a',
        })
      })

      it('should handle agent names with numbers', () => {
        const result = parseSessionName('TKT-123-Implement-agent42')
        expect(result).to.deep.equal({
          ticketId: 'TKT-123',
          action: 'Implement',
          agentName: 'agent42',
        })
      })
    })
  })
})
