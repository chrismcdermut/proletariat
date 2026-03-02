import { expect } from 'chai'

import {
  getExecutorCommand,
  buildDevcontainerCommand,
  CODEX_SUPPORTED_FLAGS,
} from '../../src/lib/execution/runners.js'
import type { ExecutionContext, ExecutorType } from '../../src/lib/execution/types.js'

/**
 * Codex Spawn Smoke Tests (TKT-1169)
 *
 * These tests enforce the Codex CLI command contract to prevent regressions
 * like the --prompt flag incident. Any change to the Codex command generation
 * MUST be accompanied by updates to these tests — CI will fail otherwise.
 *
 * Contract:
 *   - Prompt is ALWAYS positional (last argument), never passed via --prompt
 *   - Autonomous mode uses --full-auto (not --yolo)
 *   - Only flags in CODEX_SUPPORTED_FLAGS are allowed
 */
describe('Codex Spawn Smoke Tests (TKT-1169)', () => {
  const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
    ticketId: 'TKT-1169',
    ticketTitle: 'Codex spawn smoke test',
    agentName: 'test-agent',
    agentDir: '/tmp/agent',
    worktreePath: '/tmp/worktree',
    branch: 'test-branch',
    ...overrides,
  })

  // =========================================================================
  // AC 1: Failing test reproduces the --prompt regression before fix
  // =========================================================================

  describe('--prompt regression guard', () => {
    it('should NOT use --prompt flag (regression: --prompt is not a Codex CLI flag)', () => {
      const result = getExecutorCommand('codex', 'test prompt', true)
      expect(result.args).to.not.include('--prompt',
        'REGRESSION: --prompt is not a valid Codex CLI flag. ' +
        'The prompt must be passed as a positional argument.')
    })

    it('should NOT use --prompt flag in safe mode either', () => {
      const result = getExecutorCommand('codex', 'test prompt', false)
      expect(result.args).to.not.include('--prompt',
        'REGRESSION: --prompt is not a valid Codex CLI flag in any mode.')
    })

    it('should pass prompt as the last positional argument', () => {
      const prompt = 'implement the feature'
      const result = getExecutorCommand('codex', prompt, true)
      const lastArg = result.args[result.args.length - 1]
      expect(lastArg).to.equal(prompt,
        'The prompt must always be the last (positional) argument to codex.')
    })

    it('should pass prompt as positional in safe mode', () => {
      const prompt = 'review the code'
      const result = getExecutorCommand('codex', prompt, false)
      const lastArg = result.args[result.args.length - 1]
      expect(lastArg).to.equal(prompt,
        'The prompt must always be the last (positional) argument to codex.')
    })

    it('should NOT use --yolo flag (not a standard Codex CLI flag)', () => {
      const result = getExecutorCommand('codex', 'test prompt', true)
      expect(result.args).to.not.include('--yolo',
        '--yolo is not a standard Codex CLI flag. Use --full-auto instead.')
    })
  })

  // =========================================================================
  // AC 2 & 3: Unsupported flag regression prevention
  // =========================================================================

  describe('Codex command contract enforcement', () => {
    it('should export CODEX_SUPPORTED_FLAGS for contract testing', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.be.an('array')
      expect(CODEX_SUPPORTED_FLAGS.length).to.be.greaterThan(0)
    })

    it('should include --full-auto in supported flags', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.include('--full-auto')
    })

    it('should NOT include --prompt in supported flags', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.not.include('--prompt')
    })

    it('should NOT include --yolo in supported flags', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.not.include('--yolo')
    })

    it('should only use supported flags in danger mode command', () => {
      const prompt = 'test prompt'
      const result = getExecutorCommand('codex', prompt, true)

      // Extract flags (args starting with --)
      const flags = result.args.filter(a => a.startsWith('--'))

      for (const flag of flags) {
        expect(CODEX_SUPPORTED_FLAGS as readonly string[]).to.include(flag,
          `Unsupported Codex flag detected: ${flag}. ` +
          'If this flag is valid, add it to CODEX_SUPPORTED_FLAGS in runners.ts ' +
          'and update this test.')
      }
    })

    it('should only use supported flags in safe mode command', () => {
      const prompt = 'test prompt'
      const result = getExecutorCommand('codex', prompt, false)

      const flags = result.args.filter(a => a.startsWith('--'))

      for (const flag of flags) {
        expect(CODEX_SUPPORTED_FLAGS as readonly string[]).to.include(flag,
          `Unsupported Codex flag detected: ${flag}. ` +
          'If this flag is valid, add it to CODEX_SUPPORTED_FLAGS in runners.ts ' +
          'and update this test.')
      }
    })
  })

  // =========================================================================
  // Codex command shape validation
  // =========================================================================

  describe('Codex command shape', () => {
    it('should use codex binary (not claude)', () => {
      const result = getExecutorCommand('codex', 'test', true)
      expect(result.cmd).to.equal('codex')
    })

    it('danger mode: should produce codex --full-auto <prompt>', () => {
      const prompt = 'implement the feature'
      const result = getExecutorCommand('codex', prompt, true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--full-auto', prompt])
    })

    it('safe mode: should produce codex <prompt>', () => {
      const prompt = 'implement the feature'
      const result = getExecutorCommand('codex', prompt, false)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal([prompt])
    })

    it('should not contain any Claude-specific flags', () => {
      const claudeFlags = [
        '--dangerously-skip-permissions',
        '--permission-mode',
        'bypassPermissions',
        '--effort',
        '-p',
      ]

      for (const skipPerm of [true, false]) {
        const result = getExecutorCommand('codex', 'test', skipPerm)
        for (const flag of claudeFlags) {
          expect(result.args).to.not.include(flag,
            `Claude-specific flag ${flag} found in Codex command`)
        }
      }
    })
  })

  // =========================================================================
  // Runtime environment smoke tests
  // =========================================================================

  describe('Codex in devcontainer runtime', () => {
    it('should produce correct codex command for devcontainer', () => {
      const command = buildDevcontainerCommand(
        makeContext(),
        'codex',
        '/workspace/repo/.prlt-prompt.txt',
        'abc123',
        'interactive',
        false,       // sandboxed=false → skipPermissions=true → --full-auto
        'background'
      )

      expect(command).to.include('docker exec')
      expect(command).to.include('codex --full-auto')
      expect(command).to.not.include('--prompt')
      expect(command).to.not.include('--yolo')
      expect(command).to.not.include('--permission-mode')
      expect(command).to.not.include('--dangerously-skip-permissions')
    })

    it('should produce correct codex command in safe mode for devcontainer', () => {
      const command = buildDevcontainerCommand(
        makeContext(),
        'codex',
        '/workspace/repo/.prlt-prompt.txt',
        'abc123',
        'interactive',
        true,        // sandboxed=true → skipPermissions=false → no --full-auto
        'background'
      )

      expect(command).to.include('docker exec')
      expect(command).to.include('codex')
      expect(command).to.not.include('--full-auto')
      expect(command).to.not.include('--prompt')
      expect(command).to.not.include('--yolo')
    })
  })

  describe('Codex in host runtime', () => {
    it('should use codex binary on host', () => {
      const result = getExecutorCommand('codex', 'host work', true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.not.include('--prompt')
    })
  })

  describe('Codex in Docker runtime', () => {
    it('should use codex binary for Docker', () => {
      const result = getExecutorCommand('codex', 'docker work', true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.not.include('--prompt')
    })
  })

  describe('Codex in VM runtime', () => {
    it('should use codex binary for VM', () => {
      const result = getExecutorCommand('codex', 'vm work', true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.not.include('--prompt')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('Codex edge cases', () => {
    it('should handle empty prompt without --prompt flag', () => {
      const result = getExecutorCommand('codex', '', true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.not.include('--prompt')
      expect(result.args).to.deep.equal(['--full-auto', ''])
    })

    it('should handle prompt containing "--prompt" as text', () => {
      const prompt = 'Fix the --prompt handling in the CLI'
      const result = getExecutorCommand('codex', prompt, true)
      // The string "--prompt" should appear only as part of the prompt text,
      // not as a standalone flag
      const flagArgs = result.args.slice(0, -1) // all args except the prompt
      expect(flagArgs).to.not.include('--prompt')
      expect(result.args[result.args.length - 1]).to.equal(prompt)
    })

    it('should handle prompt with special characters', () => {
      const prompt = "Build the user's \"profile\" page\nStep 2: test"
      const result = getExecutorCommand('codex', prompt, true)
      expect(result.args).to.not.include('--prompt')
      expect(result.args[result.args.length - 1]).to.equal(prompt)
    })

    it('should be deterministic across multiple calls', () => {
      const prompt = 'determinism test'
      const r1 = getExecutorCommand('codex', prompt, true)
      const r2 = getExecutorCommand('codex', prompt, true)
      expect(r1).to.deep.equal(r2)
    })
  })

  // =========================================================================
  // Cross-executor isolation
  // =========================================================================

  describe('Cross-executor isolation', () => {
    it('Codex changes should not affect Claude command generation', () => {
      const claudeResult = getExecutorCommand('claude-code', 'test', true)
      expect(claudeResult.cmd).to.equal('claude')
      expect(claudeResult.args).to.include('--dangerously-skip-permissions')
      expect(claudeResult.args).to.include('--permission-mode')
    })

    it('Codex changes should not affect Aider command generation', () => {
      const aiderResult = getExecutorCommand('aider', 'test', true)
      expect(aiderResult.cmd).to.equal('aider')
      expect(aiderResult.args).to.include('--message')
    })

    it('each executor should produce a unique command binary', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex', 'aider']
      const cmds = executors.map(e => getExecutorCommand(e, 'test').cmd)
      const unique = new Set(cmds)
      expect(unique.size).to.equal(executors.length)
    })
  })
})
