import { expect } from 'chai'

import {
  parseSessionName,
  buildExpectedSessionName,
  sessionMatchesExecution,
  findSessionForExecution,
  findContainerSessionsByPrefix,
  discoverSessionId,
  resolveSessionForExecution,
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

  describe('findContainerSessionsByPrefix', () => {
    const sessionMap = new Map<string, string[]>([
      ['977b5fc9f60d', ['TKT-1087-Implement-pure-pichai']],
      ['abcdef123456', ['TKT-1005-Groom-witty-rabois']],
    ])

    it('should return exact match when container ID exists', () => {
      const result = findContainerSessionsByPrefix(sessionMap, '977b5fc9f60d')
      expect(result).to.deep.equal(['TKT-1087-Implement-pure-pichai'])
    })

    it('should match when DB has short ID and map has longer prefix', () => {
      const longMap = new Map<string, string[]>([
        ['977b5fc9f60d1234', ['TKT-1087-Implement-pure-pichai']],
      ])
      const result = findContainerSessionsByPrefix(longMap, '977b5fc9f60d')
      expect(result).to.deep.equal(['TKT-1087-Implement-pure-pichai'])
    })

    it('should match when DB has longer ID and map has short ID', () => {
      const result = findContainerSessionsByPrefix(sessionMap, '977b5fc9f60d1234')
      expect(result).to.deep.equal(['TKT-1087-Implement-pure-pichai'])
    })

    it('should return empty array when no matching container exists', () => {
      const result = findContainerSessionsByPrefix(sessionMap, 'doesnotexist')
      expect(result).to.deep.equal([])
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

  // ===========================================================================
  // Unified Session Resolution (PRLT-1263)
  // ===========================================================================

  describe('discoverSessionId', () => {
    it('should return existing sessionId when already set', () => {
      const exec = {
        ticketId: 'TKT-123',
        agentName: 'altman',
        sessionId: 'TKT-123-Implement-altman',
        environment: 'host',
      }
      const result = discoverSessionId(exec, [], new Map())
      expect(result).to.equal('TKT-123-Implement-altman')
    })

    it('should discover session from host tmux sessions when sessionId is undefined', () => {
      const exec = {
        ticketId: 'TKT-456',
        agentName: 'bezos',
        environment: 'host',
      }
      const hostSessions = ['TKT-456-Implement-bezos', 'TKT-789-Review-gates']
      const result = discoverSessionId(exec, hostSessions, new Map())
      expect(result).to.equal('TKT-456-Implement-bezos')
    })

    it('should return null when no matching host session found', () => {
      const exec = {
        ticketId: 'TKT-456',
        agentName: 'bezos',
        environment: 'host',
      }
      const hostSessions = ['TKT-789-Review-gates']
      const result = discoverSessionId(exec, hostSessions, new Map())
      expect(result).to.be.null
    })

    it('should discover session from container tmux sessions', () => {
      const exec = {
        ticketId: 'TKT-100',
        agentName: 'page',
        containerId: 'abc123',
        environment: 'docker',
      }
      const containerMap = new Map([
        ['abc123', ['TKT-100-Implement-page']],
      ])
      const result = discoverSessionId(exec, [], containerMap)
      expect(result).to.equal('TKT-100-Implement-page')
    })

    it('should return null when no matching container session found', () => {
      const exec = {
        ticketId: 'TKT-100',
        agentName: 'page',
        containerId: 'abc123',
        environment: 'docker',
      }
      const containerMap = new Map([
        ['abc123', ['TKT-200-Implement-other']],
      ])
      const result = discoverSessionId(exec, [], containerMap)
      expect(result).to.be.null
    })

    it('should handle container prefix matching', () => {
      const exec = {
        ticketId: 'TKT-100',
        agentName: 'page',
        containerId: 'abc123',
        environment: 'devcontainer',
      }
      const containerMap = new Map([
        ['abc123def456', ['TKT-100-work-page']],
      ])
      const result = discoverSessionId(exec, [], containerMap)
      expect(result).to.equal('TKT-100-work-page')
    })
  })

  describe('resolveSessionForExecution', () => {
    it('should resolve host session with existing sessionId', () => {
      const exec = {
        ticketId: 'TKT-123',
        agentName: 'altman',
        sessionId: 'TKT-123-Implement-altman',
        environment: 'host',
      }
      const result = resolveSessionForExecution(exec, [], new Map())
      expect(result).to.deep.equal({
        sessionId: 'TKT-123-Implement-altman',
        ticketId: 'TKT-123',
        agentName: 'altman',
        environment: 'host',
        containerId: undefined,
      })
    })

    it('should resolve host session by discovering from tmux', () => {
      const exec = {
        ticketId: 'TKT-456',
        agentName: 'bezos',
        environment: 'host',
      }
      const hostSessions = ['TKT-456-Review-bezos']
      const result = resolveSessionForExecution(exec, hostSessions, new Map())
      expect(result).to.deep.equal({
        sessionId: 'TKT-456-Review-bezos',
        ticketId: 'TKT-456',
        agentName: 'bezos',
        environment: 'host',
        containerId: undefined,
      })
    })

    it('should return null when no session can be found', () => {
      const exec = {
        ticketId: 'TKT-999',
        agentName: 'nonexistent',
        environment: 'host',
      }
      const result = resolveSessionForExecution(exec, [], new Map())
      expect(result).to.be.null
    })

    it('should resolve container session', () => {
      const exec = {
        ticketId: 'TKT-100',
        agentName: 'page',
        containerId: 'container1',
        environment: 'docker',
      }
      const containerMap = new Map([
        ['container1', ['TKT-100-Implement-page']],
      ])
      const result = resolveSessionForExecution(exec, [], containerMap)
      expect(result).to.deep.equal({
        sessionId: 'TKT-100-Implement-page',
        ticketId: 'TKT-100',
        agentName: 'page',
        environment: 'container',
        containerId: 'container1',
      })
    })

    it('should set environment to container when containerId is present', () => {
      const exec = {
        ticketId: 'TKT-200',
        agentName: 'gates',
        sessionId: 'TKT-200-work-gates',
        containerId: 'c1',
        environment: 'devcontainer',
      }
      const result = resolveSessionForExecution(exec, [], new Map())
      expect(result?.environment).to.equal('container')
      expect(result?.containerId).to.equal('c1')
    })

    it('should set environment to host when no containerId', () => {
      const exec = {
        ticketId: 'TKT-200',
        agentName: 'gates',
        sessionId: 'TKT-200-work-gates',
        environment: 'host',
      }
      const result = resolveSessionForExecution(exec, [], new Map())
      expect(result?.environment).to.equal('host')
      expect(result?.containerId).to.be.undefined
    })

    it('should produce same result regardless of whether sessionId is pre-set or discovered', () => {
      // This test verifies that poke and list get consistent results:
      // whether sessionId comes from DB or is discovered from tmux
      const execWithSession = {
        ticketId: 'TKT-300',
        agentName: 'musk',
        sessionId: 'TKT-300-Fix-musk',
        environment: 'host',
      }
      const execWithoutSession = {
        ticketId: 'TKT-300',
        agentName: 'musk',
        environment: 'host',
      }
      const hostSessions = ['TKT-300-Fix-musk']

      const resultWithSession = resolveSessionForExecution(execWithSession, hostSessions, new Map())
      const resultWithoutSession = resolveSessionForExecution(execWithoutSession, hostSessions, new Map())

      expect(resultWithSession).to.deep.equal(resultWithoutSession)
    })
  })
})
