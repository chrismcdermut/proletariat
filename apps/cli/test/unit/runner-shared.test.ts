import { expect } from 'chai'
import {
  buildSessionName,
  buildWindowTitle,
  buildTmuxWindowName,
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxAttachCommand,
  isDockerRunning,
  checkDockerDaemon,
  getGitHubToken,
  isGitHubTokenAvailable,
} from '../../src/lib/execution/runners/shared.js'
import type { ExecutionContext, TerminalApp } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for shared runner utilities (session naming, control mode, docker/github checks).
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-999',
  ticketTitle: 'Test Ticket',
  agentName: 'test-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'test-branch',
  ...overrides,
})

describe('Runner Shared Utilities (TKT-140)', () => {
  // =========================================================================
  // Session Name Helpers
  // =========================================================================
  describe('buildSessionName', () => {
    it('should include ticketId, action, and agent name', () => {
      const ctx = makeContext({ actionName: 'implement' })
      expect(buildSessionName(ctx)).to.equal('TKT-999-implement-test-agent')
    })

    it('should default action to "work"', () => {
      expect(buildSessionName(makeContext())).to.equal('TKT-999-work-test-agent')
    })

    it('should default agent to "agent" when agentName is empty', () => {
      expect(buildSessionName(makeContext({ agentName: '' }))).to.equal('TKT-999-work-agent')
    })

    it('should sanitize special characters in action name', () => {
      const ctx = makeContext({ actionName: 'review@comment!' })
      const result = buildSessionName(ctx)
      expect(result).to.not.include('@')
      expect(result).to.not.include('!')
    })

    it('should collapse consecutive hyphens', () => {
      const ctx = makeContext({ actionName: 'code---review' })
      const result = buildSessionName(ctx)
      expect(result).to.not.include('---')
    })

    it('should strip leading/trailing hyphens from action', () => {
      const ctx = makeContext({ actionName: '-review-' })
      const result = buildSessionName(ctx)
      expect(result).to.equal('TKT-999-review-test-agent')
    })
  })

  describe('buildWindowTitle', () => {
    it('should return same value as buildSessionName', () => {
      const ctx = makeContext({ actionName: 'implement' })
      expect(buildWindowTitle(ctx)).to.equal(buildSessionName(ctx))
    })
  })

  describe('buildTmuxWindowName', () => {
    it('should return same value as buildSessionName', () => {
      const ctx = makeContext({ actionName: 'implement' })
      expect(buildTmuxWindowName(ctx)).to.equal(buildSessionName(ctx))
    })
  })

  // =========================================================================
  // Control Mode Helpers
  // =========================================================================
  describe('shouldUseControlMode', () => {
    it('should return true only for iTerm with controlMode enabled', () => {
      expect(shouldUseControlMode('iTerm', true)).to.be.true
    })

    it('should return false for iTerm with controlMode disabled', () => {
      expect(shouldUseControlMode('iTerm', false)).to.be.false
    })

    it('should return false for all non-iTerm terminals', () => {
      const terminals: TerminalApp[] = ['Terminal', 'Alacritty', 'Ghostty', 'Kitty', 'tmux', 'Warp', 'WezTerm']
      for (const t of terminals) {
        expect(shouldUseControlMode(t, true)).to.be.false
        expect(shouldUseControlMode(t, false)).to.be.false
      }
    })
  })

  describe('buildTmuxMouseOption', () => {
    it('should always return mouse-on option regardless of param', () => {
      expect(buildTmuxMouseOption(true)).to.include('mouse on')
      expect(buildTmuxMouseOption(false)).to.include('mouse on')
    })
  })

  describe('buildTmuxAttachCommand', () => {
    it('should include -CC for control mode', () => {
      expect(buildTmuxAttachCommand(true)).to.include('-CC')
    })

    it('should not include -CC without control mode', () => {
      expect(buildTmuxAttachCommand(false)).to.not.include('-CC')
    })

    it('should include -u for unicode when requested', () => {
      expect(buildTmuxAttachCommand(false, true)).to.include('-u')
    })

    it('should include attach -d in all cases', () => {
      expect(buildTmuxAttachCommand(true)).to.include('attach -d')
      expect(buildTmuxAttachCommand(false)).to.include('attach -d')
    })
  })

  // =========================================================================
  // Docker Status
  // =========================================================================
  describe('checkDockerDaemon', () => {
    it('should return an object with available, reason, and message', () => {
      const status = checkDockerDaemon()
      expect(status).to.have.property('available').that.is.a('boolean')
      expect(status).to.have.property('reason')
      expect(['ready', 'not-installed', 'daemon-not-ready']).to.include(status.reason)
      expect(status).to.have.property('message').that.is.a('string').with.length.greaterThan(0)
    })

    it('should be consistent with isDockerRunning', () => {
      expect(checkDockerDaemon().available).to.equal(isDockerRunning())
    })

    it('should not throw', () => {
      expect(() => checkDockerDaemon()).to.not.throw()
    })
  })

  // =========================================================================
  // GitHub Token
  // =========================================================================
  describe('getGitHubToken', () => {
    it('should return string or null', () => {
      const result = getGitHubToken()
      if (result !== null) {
        expect(result).to.be.a('string')
      }
    })

    it('should not throw', () => {
      expect(() => getGitHubToken()).to.not.throw()
    })
  })

  describe('isGitHubTokenAvailable', () => {
    it('should return a boolean', () => {
      expect(isGitHubTokenAvailable()).to.be.a('boolean')
    })

    it('should be consistent with getGitHubToken', () => {
      expect(isGitHubTokenAvailable()).to.equal(getGitHubToken() !== null)
    })
  })
})
