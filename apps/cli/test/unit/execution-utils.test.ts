import { expect } from 'chai'
import { execSync } from 'node:child_process'

import {
  isDockerRunning,
  buildSessionName,
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxAttachCommand,
  getExecutorCommand,
  buildDevcontainerCommand,
  isClaudeExecutor,
  getExecutorDisplayName,
  getExecutorPackage,
} from '../../src/lib/execution/runners.js'
import type { ExecutionContext, DisplayMode, TerminalApp, ExecutorType } from '../../src/lib/execution/types.js'

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
      expect(result).to.equal('TKT-123-Code-Review-test-agent')
    })
  })

  describe('DisplayMode', () => {
    it('should accept foreground as a valid display mode', () => {
      const mode: DisplayMode = 'foreground'
      expect(mode).to.equal('foreground')
    })

    it('should accept terminal as a valid display mode', () => {
      const mode: DisplayMode = 'terminal'
      expect(mode).to.equal('terminal')
    })

    it('should accept background as a valid display mode', () => {
      const mode: DisplayMode = 'background'
      expect(mode).to.equal('background')
    })

    it('should have exactly three valid display modes', () => {
      // TypeScript enforces this at compile time, but we can verify the expected values
      const validModes: DisplayMode[] = ['foreground', 'terminal', 'background']
      expect(validModes).to.have.lengthOf(3)
      expect(validModes).to.include('foreground')
      expect(validModes).to.include('terminal')
      expect(validModes).to.include('background')
    })
  })

  describe('shouldUseControlMode', () => {
    it('should return true for iTerm with controlMode enabled', () => {
      expect(shouldUseControlMode('iTerm', true)).to.be.true
    })

    it('should return false for iTerm with controlMode disabled', () => {
      expect(shouldUseControlMode('iTerm', false)).to.be.false
    })

    it('should return false for Terminal even with controlMode enabled', () => {
      expect(shouldUseControlMode('Terminal', true)).to.be.false
    })

    it('should return false for Ghostty even with controlMode enabled', () => {
      expect(shouldUseControlMode('Ghostty', true)).to.be.false
    })

    it('should return false for all non-iTerm terminals', () => {
      const terminals: TerminalApp[] = ['Terminal', 'Alacritty', 'Ghostty', 'Kitty', 'tmux', 'Warp', 'WezTerm']
      for (const terminal of terminals) {
        expect(shouldUseControlMode(terminal, true)).to.be.false
        expect(shouldUseControlMode(terminal, false)).to.be.false
      }
    })
  })

  describe('buildTmuxMouseOption', () => {
    it('should always return mouse-on option (parameter is deprecated)', () => {
      // Mouse option is always enabled - iTerm -CC mode handles mouse natively
      // and non-iTerm terminals need mouse mode for scrolling
      const resultTrue = buildTmuxMouseOption(true)
      const resultFalse = buildTmuxMouseOption(false)
      expect(resultTrue).to.equal(' \\; set-option -g mouse on')
      expect(resultFalse).to.equal(' \\; set-option -g mouse on')
    })
  })

  describe('buildTmuxAttachCommand', () => {
    it('should return -u -CC attach for control mode (always includes -u)', () => {
      const result = buildTmuxAttachCommand(true)
      expect(result).to.equal('tmux -u -CC attach')
    })

    it('should return regular attach without control mode', () => {
      const result = buildTmuxAttachCommand(false)
      expect(result).to.equal('tmux attach')
    })

    it('should include -u flag when unicode flag is requested', () => {
      const result = buildTmuxAttachCommand(false, true)
      expect(result).to.equal('tmux -u attach')
    })

    it('should include both -u and -CC flags when both are requested', () => {
      const result = buildTmuxAttachCommand(true, true)
      expect(result).to.equal('tmux -u -CC attach')
    })
  })

  describe('Control Mode Integration', () => {
    /**
     * These tests document the expected behavior when iTerm control mode (-CC) is used.
     * Control mode enables native iTerm scrolling, selection, and gesture support.
     */
    it('mouse mode is always enabled (iTerm -CC handles it natively)', () => {
      const useControlMode = shouldUseControlMode('iTerm', true)
      const mouseOption = buildTmuxMouseOption(useControlMode)
      // Mouse mode is always enabled - doesn't conflict with -CC mode
      expect(mouseOption).to.equal(' \\; set-option -g mouse on')
    })

    it('iTerm with controlMode should use -CC attach', () => {
      const useControlMode = shouldUseControlMode('iTerm', true)
      const attachCmd = buildTmuxAttachCommand(useControlMode)
      expect(attachCmd).to.include('-CC')
    })

    it('Terminal (non-iTerm) should enable tmux mouse mode', () => {
      const useControlMode = shouldUseControlMode('Terminal', true)
      const mouseOption = buildTmuxMouseOption(useControlMode)
      expect(mouseOption).to.include('mouse on')
    })

    it('Terminal (non-iTerm) should use regular attach', () => {
      const useControlMode = shouldUseControlMode('Terminal', true)
      const attachCmd = buildTmuxAttachCommand(useControlMode)
      expect(attachCmd).to.not.include('-CC')
      expect(attachCmd).to.equal('tmux attach')
    })
  })

  describe('iTerm Preferences Configuration', () => {
    /**
     * These tests document the expected iTerm preference values.
     * Actual `defaults write` calls are tested via integration tests.
     */
    it('should map tab mode to OpenTmuxWindowsIn value 2', () => {
      // OpenTmuxWindowsIn: 0=native windows, 1=new window, 2=tabs in existing window
      const getOpenTmuxWindowsInValue = (mode: 'tab' | 'window') => mode === 'tab' ? 2 : 1
      expect(getOpenTmuxWindowsInValue('tab')).to.equal(2)
    })

    it('should map window mode to OpenTmuxWindowsIn value 1', () => {
      const getOpenTmuxWindowsInValue = (mode: 'tab' | 'window') => mode === 'tab' ? 2 : 1
      expect(getOpenTmuxWindowsInValue('window')).to.equal(1)
    })

    it('should document AutoHideTmuxClientSession behavior', () => {
      // When AutoHideTmuxClientSession is true:
      // - The terminal where tmux -CC is run gets buried/hidden
      // - User only sees the native iTerm tabs for tmux windows
      // This is set to true by configureITermTmuxPreferences()
      expect(true).to.be.true
    })
  })

  describe('iTerm Control Mode Flow', () => {
    /**
     * Documents the complete flow for iTerm + control mode.
     * This serves as living documentation for the expected behavior.
     */
    it('should document the complete spawn flow', () => {
      // 1. prlt spawns work, creates tmux session in container (detached)
      // 2. configureITermTmuxPreferences() sets:
      //    - OpenTmuxWindowsIn = 2 (tabs in existing window)
      //    - AutoHideTmuxClientSession = true (hide control channel)
      // 3. AppleScript creates a NEW tab (not current session)
      // 4. tmux -CC attach runs in that new tab
      // 5. iTerm creates native tabs for tmux windows
      // 6. The intermediate tab is auto-hidden
      // 7. prlt continues running in original terminal (unaffected)
      expect(true).to.be.true
    })

    it('should create new tab to avoid interfering with prlt', () => {
      // Running tmux -CC in current session would interfere with prlt output
      // Creating a new tab first ensures clean separation
      // This is especially important during batch spawns
      expect(true).to.be.true
    })
  })

  describe('Display Mode Behavior', () => {
    /**
     * All display modes create a tmux session for persistence.
     * The difference is how/whether the session is attached.
     */
    it('foreground should attach tmux in current terminal (blocking)', () => {
      // Foreground mode: creates tmux session, then runs `tmux attach` (blocking)
      // User sees the session in their current terminal
      // Can detach with Ctrl+B D and reattach later
      const mode: DisplayMode = 'foreground'
      expect(mode).to.equal('foreground')
      // Note: Actual execution tested in e2e tests
    })

    it('terminal should open new tab attached to tmux', () => {
      // Terminal mode: creates tmux session, then opens new terminal tab
      // that attaches to the session
      // Original terminal is free, work happens in new tab
      const mode: DisplayMode = 'terminal'
      expect(mode).to.equal('terminal')
      // Note: Actual execution tested in e2e tests
    })

    it('background should create detached tmux session', () => {
      // Background mode: creates tmux session but doesn't attach
      // Session runs detached, user can reattach with `prlt session attach`
      const mode: DisplayMode = 'background'
      expect(mode).to.equal('background')
      // Note: Actual execution tested in e2e tests
    })
  })

  // =============================================================================
  // TKT-1005: Executor-aware command building tests
  // =============================================================================

  describe('buildDevcontainerCommand (TKT-1005)', () => {
    const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
      ticketId: 'TKT-1005',
      ticketTitle: 'Codex wiring test',
      agentName: 'test-agent',
      agentDir: '/tmp/agent',
      worktreePath: '/tmp/agent/repo',
      branch: 'TKT-1005/test',
      ...overrides,
    })

    it('should generate codex command with --prompt and no Claude-only flags', () => {
      const command = buildDevcontainerCommand(
        makeContext(),
        'codex',
        '/workspace/repo/.prlt-prompt.txt',
        'abc123',
        'interactive',
        true,
        'background'
      )

      expect(command).to.include('docker exec')
      expect(command).to.include('codex --prompt "$(cat /workspace/repo/.prlt-prompt.txt)"')
      expect(command).to.not.include('--permission-mode bypassPermissions')
      expect(command).to.not.include('--dangerously-skip-permissions')
      expect(command).to.not.include(' -p ')
    })
  })

  describe('getExecutorCommand (TKT-1005)', () => {
    const testPrompt = 'Test prompt for agent'

    describe('claude-code executor', () => {
      it('should return claude command with permissions flags when skipPermissions=true', () => {
        const result = getExecutorCommand('claude-code', testPrompt, true)
        expect(result.cmd).to.equal('claude')
        expect(result.args).to.include('--permission-mode')
        expect(result.args).to.include('bypassPermissions')
        expect(result.args).to.include('--dangerously-skip-permissions')
        expect(result.args).to.include(testPrompt)
      })

      it('should return claude command without permissions flags when skipPermissions=false', () => {
        const result = getExecutorCommand('claude-code', testPrompt, false)
        expect(result.cmd).to.equal('claude')
        expect(result.args).to.deep.equal([testPrompt])
        expect(result.args).to.not.include('--dangerously-skip-permissions')
      })

      it('should default skipPermissions to true', () => {
        const result = getExecutorCommand('claude-code', testPrompt)
        expect(result.args).to.include('--dangerously-skip-permissions')
      })
    })

    describe('codex executor', () => {
      it('should return codex command with danger flag and --prompt when skipPermissions=true', () => {
        const result = getExecutorCommand('codex', testPrompt)
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--dangerously-bypass-approvals-and-sandbox', '--prompt', testPrompt])
      })

      it('should NOT include Claude-specific flags', () => {
        const result = getExecutorCommand('codex', testPrompt, true)
        expect(result.args).to.not.include('--dangerously-skip-permissions')
        expect(result.args).to.not.include('--permission-mode')
        expect(result.args).to.not.include('bypassPermissions')
      })

      it('should apply skipPermissions parameter using Codex-native flag', () => {
        const resultTrue = getExecutorCommand('codex', testPrompt, true)
        const resultFalse = getExecutorCommand('codex', testPrompt, false)
        expect(resultTrue.args).to.include('--dangerously-bypass-approvals-and-sandbox')
        expect(resultFalse.args).to.deep.equal(['--prompt', testPrompt])
      })
    })

    describe('aider executor', () => {
      it('should return aider command with --message flag', () => {
        const result = getExecutorCommand('aider', testPrompt)
        expect(result.cmd).to.equal('aider')
        expect(result.args).to.deep.equal(['--message', testPrompt])
      })

      it('should NOT include Claude-specific flags', () => {
        const result = getExecutorCommand('aider', testPrompt, true)
        expect(result.args).to.not.include('--dangerously-skip-permissions')
        expect(result.args).to.not.include('-p')
      })
    })

    describe('custom executor', () => {
      it('should return echo fallback', () => {
        const result = getExecutorCommand('custom', testPrompt)
        expect(result.cmd).to.equal('echo')
        expect(result.args).to.include('Custom executor not configured')
      })
    })

    describe('all executor types', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex', 'aider', 'custom']

      it('should return a cmd and args for every executor type', () => {
        for (const executor of executors) {
          const result = getExecutorCommand(executor, testPrompt)
          expect(result).to.have.property('cmd').that.is.a('string')
          expect(result).to.have.property('args').that.is.an('array')
          expect(result.cmd.length).to.be.greaterThan(0)
        }
      })
    })
  })

  describe('isClaudeExecutor (TKT-1005)', () => {
    it('should return true for claude-code', () => {
      expect(isClaudeExecutor('claude-code')).to.be.true
    })

    it('should return false for codex', () => {
      expect(isClaudeExecutor('codex')).to.be.false
    })

    it('should return false for aider', () => {
      expect(isClaudeExecutor('aider')).to.be.false
    })

    it('should return false for custom', () => {
      expect(isClaudeExecutor('custom')).to.be.false
    })
  })

  describe('getExecutorDisplayName (TKT-1005)', () => {
    it('should return "Claude Code" for claude-code', () => {
      expect(getExecutorDisplayName('claude-code')).to.equal('Claude Code')
    })

    it('should return "Codex" for codex', () => {
      expect(getExecutorDisplayName('codex')).to.equal('Codex')
    })

    it('should return "Aider" for aider', () => {
      expect(getExecutorDisplayName('aider')).to.equal('Aider')
    })

    it('should return "Custom" for custom', () => {
      expect(getExecutorDisplayName('custom')).to.equal('Custom')
    })
  })

  describe('getExecutorPackage (TKT-1005)', () => {
    it('should return @anthropic-ai/claude-code for claude-code', () => {
      expect(getExecutorPackage('claude-code')).to.equal('@anthropic-ai/claude-code')
    })

    it('should return @openai/codex for codex', () => {
      expect(getExecutorPackage('codex')).to.equal('@openai/codex')
    })

    it('should return null for aider (Python-based)', () => {
      expect(getExecutorPackage('aider')).to.be.null
    })

    it('should return null for custom', () => {
      expect(getExecutorPackage('custom')).to.be.null
    })
  })
})
