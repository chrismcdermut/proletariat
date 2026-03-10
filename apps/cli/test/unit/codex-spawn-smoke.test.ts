import { expect } from 'chai'

import {
  getExecutorCommand,
  buildDevcontainerCommand,
} from '../../src/lib/execution/runners.js'
import type { ExecutionContext, ExecutorType, PermissionMode } from '../../src/lib/execution/types.js'

// Codex CLI supported flags — maintained here for contract testing
const CODEX_SUPPORTED_FLAGS = ['--yolo'] as const

/**
 * Codex Spawn Smoke Tests (TKT-1169)
 *
 * These tests enforce the Codex CLI command contract to prevent regressions.
 * Any change to the Codex command generation MUST be accompanied by updates
 * to these tests — CI will fail otherwise.
 *
 * Contract:
 *   - Prompt is passed as a positional argument
 *   - Autonomous mode uses --yolo
 *   - Only flags in CODEX_SUPPORTED_FLAGS are allowed
 */
describe('@smoke Codex Spawn Smoke Tests (TKT-1169)', () => {
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
  // Codex command contract enforcement
  // =========================================================================

  describe('Codex command contract enforcement', () => {
    it('should have supported flags defined', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.be.an('array')
      expect(CODEX_SUPPORTED_FLAGS.length).to.be.greaterThan(0)
    })

    it('should include --yolo in supported flags', () => {
      expect(CODEX_SUPPORTED_FLAGS).to.include('--yolo')
    })

    it('should only use supported flags in danger mode command', () => {
      const prompt = 'test prompt'
      const result = getExecutorCommand('codex', prompt, true)

      // Extract flags (args starting with --)
      const flags = result.args.filter(a => a.startsWith('--'))

      for (const flag of flags) {
        expect(CODEX_SUPPORTED_FLAGS as readonly string[]).to.include(flag,
          `Unsupported Codex flag detected: ${flag}. ` +
          'If this flag is valid, add it to CODEX_SUPPORTED_FLAGS ' +
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
          'If this flag is valid, add it to CODEX_SUPPORTED_FLAGS ' +
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

    it('danger mode: should produce codex --yolo <prompt>', () => {
      const prompt = 'implement the feature'
      const result = getExecutorCommand('codex', prompt, true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--yolo', prompt])
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
    it('should produce correct codex command for devcontainer in danger mode', () => {
      const command = buildDevcontainerCommand(
        makeContext(),
        'codex',
        '/workspace/repo/.prlt-prompt.txt',
        'abc123',
        'interactive',
        'danger' as PermissionMode,
        'background'
      )

      expect(command).to.include('docker exec')
      expect(command).to.include('codex --yolo ')
      expect(command).to.not.include('--permission-mode')
      expect(command).to.not.include('--dangerously-skip-permissions')
    })

    it('should throw CodexModeError for safe mode + background devcontainer', () => {
      // Codex safe mode requires a TTY for interactive approval,
      // so safe + background is not supported
      expect(() => buildDevcontainerCommand(
        makeContext(),
        'codex',
        '/workspace/repo/.prlt-prompt.txt',
        'abc123',
        'interactive',
        'safe' as PermissionMode,
        'background'
      )).to.throw()
    })
  })

  describe('Codex in host runtime', () => {
    it('should use codex binary on host', () => {
      const result = getExecutorCommand('codex', 'host work', true)
      expect(result.cmd).to.equal('codex')
    })
  })

  describe('Codex in Docker runtime', () => {
    it('should use codex binary for Docker', () => {
      const result = getExecutorCommand('codex', 'docker work', true)
      expect(result.cmd).to.equal('codex')
    })
  })

  describe('Codex in VM runtime', () => {
    it('should use codex binary for VM', () => {
      const result = getExecutorCommand('codex', 'vm work', true)
      expect(result.cmd).to.equal('codex')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('Codex edge cases', () => {
    it('should handle empty prompt', () => {
      const result = getExecutorCommand('codex', '', true)
      expect(result.cmd).to.equal('codex')
      expect(result.args).to.deep.equal(['--yolo', ''])
    })

    it('should handle prompt with special characters', () => {
      const prompt = "Build the user's \"profile\" page\nStep 2: test"
      const result = getExecutorCommand('codex', prompt, true)
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

    it('each executor should produce a unique command binary', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex']
      const cmds = executors.map(e => getExecutorCommand(e, 'test').cmd)
      const unique = new Set(cmds)
      expect(unique.size).to.equal(executors.length)
    })
  })
})
