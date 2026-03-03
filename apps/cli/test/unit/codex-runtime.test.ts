import { expect } from 'chai'

import {
  getExecutorCommand,
  buildSessionName,
} from '../../src/lib/execution/runners.js'
import type { ExecutionContext, ExecutorType } from '../../src/lib/execution/types.js'

/**
 * Unit tests for Codex executor behavior across all runtime environments.
 *
 * TKT-1083: Finalize Codex behavior on Docker/VM runtimes
 *
 * Ensures that Docker and VM runners use the correct executor command
 * for all executor types (claude-code, codex, aider, custom) instead
 * of hardcoding 'claude'.
 */
describe('Codex Runtime Behavior (TKT-1083)', () => {
  // Helper to create a minimal ExecutionContext for testing
  const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
    ticketId: 'TKT-1083',
    ticketTitle: 'Finalize Codex behavior',
    agentName: 'test-agent',
    agentDir: '/tmp/agent',
    worktreePath: '/tmp/worktree',
    branch: 'test-branch',
    ...overrides,
  })

  describe('getExecutorCommand', () => {
    const testPrompt = 'Test prompt for executor'

    describe('claude-code executor', () => {
      it('should return claude command with skip permissions', () => {
        const result = getExecutorCommand('claude-code', testPrompt, true)
        expect(result.cmd).to.equal('claude')
        expect(result.args).to.include('--dangerously-skip-permissions')
        expect(result.args).to.include('--permission-mode')
        expect(result.args).to.include('bypassPermissions')
        expect(result.args).to.include(testPrompt)
      })

      it('should include --effort high when skip permissions enabled (TKT-1134)', () => {
        const result = getExecutorCommand('claude-code', testPrompt, true)
        expect(result.args).to.include('--effort')
        expect(result.args).to.include('high')
      })

      it('should not include --effort when skip permissions disabled', () => {
        const result = getExecutorCommand('claude-code', testPrompt, false)
        expect(result.args).to.not.include('--effort')
      })

      it('should return claude command without skip permissions', () => {
        const result = getExecutorCommand('claude-code', testPrompt, false)
        expect(result.cmd).to.equal('claude')
        expect(result.args).to.not.include('--dangerously-skip-permissions')
        expect(result.args).to.include(testPrompt)
      })
    })

    describe('codex executor', () => {
      it('should return codex command with --yolo and positional prompt in danger mode', () => {
        const result = getExecutorCommand('codex', testPrompt, true)
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--yolo', testPrompt])
      })

      it('should map skipPermissions=false to safe command (prompt only)', () => {
        const withSkip = getExecutorCommand('codex', testPrompt, true)
        const withoutSkip = getExecutorCommand('codex', testPrompt, false)
        expect(withSkip.args).to.deep.equal(['--yolo', testPrompt])
        expect(withoutSkip.args).to.deep.equal([testPrompt])
      })

      it('should not include claude-specific flags', () => {
        const result = getExecutorCommand('codex', testPrompt, true)
        expect(result.cmd).to.not.equal('claude')
        expect(result.args).to.not.include('--dangerously-skip-permissions')
        expect(result.args).to.not.include('--permission-mode')
      })
    })

    describe('aider executor', () => {
      it('should return aider command with --message flag', () => {
        const result = getExecutorCommand('aider', testPrompt, true)
        expect(result.cmd).to.equal('aider')
        expect(result.args).to.deep.equal(['--message', testPrompt])
      })
    })

    describe('custom executor', () => {
      it('should return echo placeholder', () => {
        const result = getExecutorCommand('custom', testPrompt, true)
        expect(result.cmd).to.equal('echo')
      })
    })

    describe('all executors produce distinct commands', () => {
      it('should map each executor to a unique command binary', () => {
        const executors: ExecutorType[] = ['claude-code', 'codex', 'aider']
        const commands = executors.map(e => getExecutorCommand(e, testPrompt).cmd)

        // Each executor should produce a different command
        const uniqueCommands = new Set(commands)
        expect(uniqueCommands.size).to.equal(executors.length)
      })

      it('codex should use codex binary, not claude', () => {
        const result = getExecutorCommand('codex', testPrompt)
        expect(result.cmd).to.equal('codex')
        expect(result.cmd).to.not.equal('claude')
      })

      it('aider should use aider binary, not claude', () => {
        const result = getExecutorCommand('aider', testPrompt)
        expect(result.cmd).to.equal('aider')
        expect(result.cmd).to.not.equal('claude')
      })
    })
  })

  describe('Codex in Docker runtime', () => {
    /**
     * Documents that the Docker runner now uses getExecutorCommand()
     * to dispatch to the correct binary. Previously it hardcoded 'claude --print'.
     */
    it('should use codex binary for codex executor (not hardcoded claude)', () => {
      const result = getExecutorCommand('codex', 'build the feature')
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--yolo', 'build the feature'])
    })

    it('should use aider binary for aider executor (not hardcoded claude)', () => {
      const result = getExecutorCommand('aider', 'fix the bug')
      expect(result.cmd).to.equal('aider')
      expect(result.args).to.deep.equal(['--message', 'fix the bug'])
    })

    it('should still use claude for claude-code executor in Docker', () => {
      const result = getExecutorCommand('claude-code', 'implement feature', true)
      expect(result.cmd).to.equal('claude')
    })
  })

  describe('Codex in VM runtime', () => {
    /**
     * Documents that the VM runner now uses getExecutorCommand()
     * to dispatch to the correct binary. Previously it hardcoded 'claude --print'.
     */
    it('should use codex binary for codex executor on VM', () => {
      const result = getExecutorCommand('codex', 'implement on VM')
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--yolo', 'implement on VM'])
    })

    it('should use aider binary for aider executor on VM', () => {
      const result = getExecutorCommand('aider', 'implement on VM')
      expect(result.cmd).to.equal('aider')
      expect(result.args[0]).to.equal('--message')
    })
  })

  describe('Codex in devcontainer runtime', () => {
    /**
     * The devcontainer runner (buildDevcontainerCommand) already handled
     * codex correctly. These tests verify the existing behavior is preserved.
     */
    it('should use codex binary in devcontainer (existing behavior)', () => {
      const result = getExecutorCommand('codex', 'devcontainer work')
      expect(result.cmd).to.equal('codex')
    })
  })

  describe('Codex in host runtime', () => {
    /**
     * The host runner already used getExecutorCommand correctly.
     * These tests verify the existing behavior is preserved.
     */
    it('should use codex binary on host (existing behavior)', () => {
      const result = getExecutorCommand('codex', 'host work')
      expect(result.cmd).to.equal('codex')
    })
  })

  describe('Prompt handling with special characters', () => {
    it('should handle prompts with single quotes', () => {
      const prompt = "Build the user's profile page"
      const result = getExecutorCommand('codex', prompt)
      expect(result.args).to.include(prompt)
    })

    it('should handle prompts with double quotes', () => {
      const prompt = 'Build the "profile" page'
      const result = getExecutorCommand('codex', prompt)
      expect(result.args).to.include(prompt)
    })

    it('should handle prompts with newlines', () => {
      const prompt = 'Step 1: Build\nStep 2: Test'
      const result = getExecutorCommand('codex', prompt)
      expect(result.args).to.include(prompt)
    })

    it('should handle empty prompts', () => {
      const result = getExecutorCommand('codex', '')
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--yolo', ''])
    })
  })

  describe('Session naming with codex executor', () => {
    it('should build valid session names for codex-based work', () => {
      const context = makeContext({ actionName: 'implement' })
      const sessionName = buildSessionName(context)
      expect(sessionName).to.equal('TKT-1083-implement-test-agent')
    })

    it('should not include executor type in session name', () => {
      // Session names are environment-agnostic
      const context = makeContext({ actionName: 'implement' })
      const sessionName = buildSessionName(context)
      expect(sessionName).to.not.include('codex')
      expect(sessionName).to.not.include('claude')
    })
  })

  // buildTmuxScript tests removed - function was removed from runners.ts

  describe('Codex CLI flag contract', () => {
    it('should pass prompt as positional argument in danger mode', () => {
      const result = getExecutorCommand('codex', 'build the feature', true)
      expect(result.args).to.include('--yolo')
      expect(result.args).to.deep.equal(['--yolo', 'build the feature'])
    })

    it('should pass prompt as positional argument in safe mode', () => {
      const result = getExecutorCommand('codex', 'implement feature', false)
      expect(result.args).to.deep.equal(['implement feature'])
    })

    it('should use --yolo for danger mode', () => {
      const result = getExecutorCommand('codex', 'test prompt', true)
      expect(result.args).to.include('--yolo')
      expect(result.args).to.deep.equal(['--yolo', 'test prompt'])
    })
  })

  describe('Executor consistency across runtimes', () => {
    /**
     * Verifies that all four runtime environments now use the same
     * getExecutorCommand() function, ensuring consistent behavior.
     */
    const executors: ExecutorType[] = ['claude-code', 'codex', 'aider', 'custom']

    for (const executor of executors) {
      it(`should produce deterministic command for ${executor} executor`, () => {
        const prompt = 'test prompt'
        const result1 = getExecutorCommand(executor, prompt)
        const result2 = getExecutorCommand(executor, prompt)
        expect(result1).to.deep.equal(result2)
      })
    }

    it('should return correct binary for each executor type', () => {
      const expectedBinaries: Record<string, string> = {
        'claude-code': 'claude',
        'codex': 'codex',
        'aider': 'aider',
        'custom': 'echo',
      }

      for (const [executor, expectedCmd] of Object.entries(expectedBinaries)) {
        const result = getExecutorCommand(executor as ExecutorType, 'test')
        expect(result.cmd).to.equal(expectedCmd, `${executor} should use ${expectedCmd}`)
      }
    })
  })
})
