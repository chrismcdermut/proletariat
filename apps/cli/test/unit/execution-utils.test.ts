import { expect } from 'chai'
import { execSync } from 'node:child_process'

import { isDockerRunning, buildSessionName } from '../../src/lib/execution/runners.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

/**
 * Unit tests for execution utility functions
 */
describe('Execution Utils', () => {
  describe('isDockerRunning', () => {
    it('should return a boolean', () => {
      const result = isDockerRunning()
      expect(result).to.be.a('boolean')
    })

    it('should match actual docker info command result', () => {
      // Get the expected result by running docker info directly
      let dockerAvailable: boolean
      try {
        execSync('docker info', { stdio: 'pipe', timeout: 5000 })
        dockerAvailable = true
      } catch {
        dockerAvailable = false
      }

      const result = isDockerRunning()
      expect(result).to.equal(dockerAvailable)
    })

    it('should not throw an error regardless of Docker state', () => {
      // The function should handle errors gracefully
      expect(() => isDockerRunning()).to.not.throw()
    })
  })

  describe('buildSessionName', () => {
    // Helper to create a minimal ExecutionContext for testing
    const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
      ticketId: 'TKT-123',
      ticketTitle: 'Test Ticket',
      agentName: 'test-agent',
      agentDir: '/tmp/agent',
      worktreePath: '/tmp/worktree',
      branch: 'test-branch',
      ...overrides,
    })

    it('should build session name with action name', () => {
      const context = makeContext({ actionName: 'implement' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-implement-test-agent')
    })

    it('should default action to "work" when not provided', () => {
      const context = makeContext()
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-work-test-agent')
    })

    it('should default agent to "agent" when not provided', () => {
      const context = makeContext({ agentName: '' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-work-agent')
    })

    it('should replace spaces in action name with hyphens', () => {
      const context = makeContext({ actionName: 'Code Review' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-Code-Review-test-agent')
    })

    it('should replace multiple spaces with single hyphen', () => {
      const context = makeContext({ actionName: 'Code   Review' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-Code-Review-test-agent')
    })

    it('should handle tabs and other whitespace', () => {
      const context = makeContext({ actionName: 'Code\tReview' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123-Code-Review-test-agent')
    })

    it('should handle leading and trailing spaces', () => {
      const context = makeContext({ actionName: ' Code Review ' })
      const result = buildSessionName(context)
      expect(result).to.equal('TKT-123--Code-Review--test-agent')
    })
  })
})
