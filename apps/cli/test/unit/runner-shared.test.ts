import { expect } from 'chai'
import {
  buildSessionName,
  buildWindowTitle,
  buildTmuxWindowName,
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxTitleOptions,
  buildTmuxAttachCommand,
  isDockerRunning,
  checkDockerDaemon,
  getGitHubToken,
  isGitHubTokenAvailable,
  getGitHubTokenScopes,
  parseScopesFromAuthStatus,
  hasWorkflowScope,
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

    it('should use HQ-scoped naming for orchestrator contexts', () => {
      const ctx = makeContext({
        ticketId: 'prlt',
        actionName: 'orchestrator',
        agentName: 'main',
        isOrchestrator: true,
        hqName: 'proletariat',
      })
      expect(buildSessionName(ctx)).to.equal('prlt-orchestrator-proletariat-main')
    })

    it('should use HQ-scoped naming for named orchestrator', () => {
      const ctx = makeContext({
        ticketId: 'prlt',
        actionName: 'orchestrator',
        agentName: 'ops',
        isOrchestrator: true,
        hqName: 'my-project',
      })
      expect(buildSessionName(ctx)).to.equal('prlt-orchestrator-my-project-ops')
    })

    it('should fall back to default hqName when hqName is empty', () => {
      const ctx = makeContext({
        ticketId: 'prlt',
        actionName: 'orchestrator',
        agentName: 'main',
        isOrchestrator: true,
        hqName: '',
      })
      // Empty hqName means isOrchestrator && context.hqName is falsy, falls back to standard format
      expect(buildSessionName(ctx)).to.equal('prlt-orchestrator-main')
    })

    it('should use standard naming when not orchestrator even with hqName', () => {
      const ctx = makeContext({
        hqName: 'proletariat',
        actionName: 'implement',
      })
      expect(buildSessionName(ctx)).to.equal('TKT-999-implement-test-agent')
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

  // =========================================================================
  // PRLT-1351: tmux title options escaping
  // =========================================================================
  describe('buildTmuxTitleOptions', () => {
    it('should include set-titles on and set-titles-string', () => {
      const result = buildTmuxTitleOptions()
      expect(result).to.include('set-titles on')
      expect(result).to.include('set-titles-string')
    })

    it('should contain backslash-escaped semicolons for bash passthrough', () => {
      // PRLT-1351 regression: without \\; in the JS source, template literals
      // produce bare ; which bash treats as a command separator instead of
      // passing it through to tmux. The string value must contain literal \;
      const result = buildTmuxTitleOptions()
      expect(result).to.include('\\;')
      // Must NOT contain bare ; (without preceding backslash) as a tmux separator
      // Split on \; first, then check remaining parts don't have bare ;
      const withoutEscaped = result.replace(/\\;/g, '')
      expect(withoutEscaped).to.not.include(';',
        'bare semicolons without backslash escape will be parsed by bash, not tmux')
    })

    it('should use same escaping pattern as buildTmuxMouseOption', () => {
      // Both helpers must use \\; so they are safe when concatenated into
      // a command string passed through bash -c (devcontainer) or execSync (host)
      const mouseOpt = buildTmuxMouseOption(false)
      const titleOpt = buildTmuxTitleOptions()
      // Both should have \; in the runtime string value
      expect(mouseOpt).to.include('\\;')
      expect(titleOpt).to.include('\\;')
    })

    it('should produce command that bash -c passes through to tmux correctly', () => {
      // Simulate what happens when the options are embedded in a bash -c command:
      // The \\; in JS becomes \; in the string, which inside bash -c single quotes
      // is interpreted as a literal ; and forwarded to tmux as a command separator.
      const mouseOpt = buildTmuxMouseOption(false)
      const titleOpt = buildTmuxTitleOptions()
      const cmd = `tmux new-session -d -s "test" "script.sh"${mouseOpt}${titleOpt}`
      // Count bare semicolons (not preceded by backslash) — should be zero
      const bareSemicolons = cmd.match(/(?<!\\);/g)
      expect(bareSemicolons).to.be.null
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

  // =========================================================================
  // GitHub Token Scopes (PRLT-1095)
  // =========================================================================
  describe('parseScopesFromAuthStatus', () => {
    it('should parse scopes from active account', () => {
      const output = [
        'github.com',
        '  ✓ Logged in to github.com account testuser (GITHUB_TOKEN)',
        '  - Active account: true',
        '  - Git operations protocol: ssh',
        '  - Token: gho_****',
        "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
      ].join('\n')
      const scopes = parseScopesFromAuthStatus(output)
      expect(scopes).to.deep.equal(['gist', 'read:org', 'repo', 'workflow'])
    })

    it('should prefer active account over inactive account', () => {
      const output = [
        'github.com',
        '  ✓ Logged in to github.com account user1 (GITHUB_TOKEN)',
        '  - Active account: true',
        '  - Token: gho_****',
        "  - Token scopes: 'repo'",
        '',
        '  ✓ Logged in to github.com account user2 (hosts.yml)',
        '  - Active account: false',
        '  - Token: gho_****',
        "  - Token scopes: 'repo', 'workflow'",
      ].join('\n')
      const scopes = parseScopesFromAuthStatus(output)
      expect(scopes).to.deep.equal(['repo'])
      expect(scopes).to.not.include('workflow')
    })

    it('should return empty array for no scopes', () => {
      const output = [
        '  - Active account: true',
        "  - Token scopes: ''",
      ].join('\n')
      expect(parseScopesFromAuthStatus(output)).to.deep.equal([])
    })

    it('should return empty array for empty input', () => {
      expect(parseScopesFromAuthStatus('')).to.deep.equal([])
    })

    it('should fall back to first Token scopes line when no Active account markers', () => {
      const output = [
        'github.com',
        '  ✓ Logged in to github.com',
        "  - Token scopes: 'repo', 'workflow'",
      ].join('\n')
      const scopes = parseScopesFromAuthStatus(output)
      expect(scopes).to.deep.equal(['repo', 'workflow'])
    })
  })

  describe('getGitHubTokenScopes', () => {
    it('should return an array', () => {
      const scopes = getGitHubTokenScopes()
      expect(scopes).to.be.an('array')
    })

    it('should not throw', () => {
      expect(() => getGitHubTokenScopes()).to.not.throw()
    })
  })

  describe('hasWorkflowScope', () => {
    it('should return a boolean', () => {
      expect(hasWorkflowScope()).to.be.a('boolean')
    })

    it('should not throw', () => {
      expect(() => hasWorkflowScope()).to.not.throw()
    })
  })
})
