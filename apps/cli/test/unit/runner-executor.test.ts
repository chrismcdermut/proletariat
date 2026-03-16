import { expect } from 'chai'
import {
  getExecutorCommand,
  isClaudeExecutor,
  getExecutorDisplayName,
  getExecutorPackage,
  runExecutorPreflight,
} from '../../src/lib/execution/runners/executor.js'
import type { ExecutorType, ExecutionEnvironment } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for executor command building and preflight checks.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

describe('Executor Command Building (TKT-140)', () => {
  const testPrompt = 'Implement the feature as described in the ticket.'

  // =========================================================================
  // getExecutorCommand
  // =========================================================================
  describe('getExecutorCommand', () => {
    describe('claude-code executor', () => {
      it('should return "claude" as the command', () => {
        const { cmd } = getExecutorCommand('claude-code', testPrompt, true)
        expect(cmd).to.equal('claude')
      })

      it('should include --dangerously-skip-permissions when skipPermissions=true', () => {
        const { args } = getExecutorCommand('claude-code', testPrompt, true)
        expect(args).to.include('--dangerously-skip-permissions')
      })

      it('should include --permission-mode bypassPermissions when skipPermissions=true', () => {
        const { args } = getExecutorCommand('claude-code', testPrompt, true)
        expect(args).to.include('--permission-mode')
        expect(args).to.include('bypassPermissions')
      })

      it('should include --effort high when skipPermissions=true', () => {
        const { args } = getExecutorCommand('claude-code', testPrompt, true)
        expect(args).to.include('--effort')
        expect(args).to.include('high')
      })

      it('should include only prompt when skipPermissions=false', () => {
        const { args } = getExecutorCommand('claude-code', testPrompt, false)
        expect(args).to.deep.equal([testPrompt])
      })

      it('should default skipPermissions to true', () => {
        const { args } = getExecutorCommand('claude-code', testPrompt)
        expect(args).to.include('--dangerously-skip-permissions')
      })

      it('should always include the prompt in args', () => {
        const r1 = getExecutorCommand('claude-code', testPrompt, true)
        const r2 = getExecutorCommand('claude-code', testPrompt, false)
        expect(r1.args).to.include(testPrompt)
        expect(r2.args).to.include(testPrompt)
      })
    })

    describe('codex executor', () => {
      it('should return "codex" as the command', () => {
        const { cmd } = getExecutorCommand('codex', testPrompt)
        expect(cmd).to.equal('codex')
      })

      it('should include --yolo when skipPermissions=true', () => {
        const { args } = getExecutorCommand('codex', testPrompt, true)
        expect(args).to.include('--yolo')
      })

      it('should NOT include Claude-specific flags', () => {
        const { args } = getExecutorCommand('codex', testPrompt, true)
        expect(args).to.not.include('--dangerously-skip-permissions')
        expect(args).to.not.include('--permission-mode')
        expect(args).to.not.include('bypassPermissions')
      })

      it('should include only prompt when skipPermissions=false', () => {
        const { args } = getExecutorCommand('codex', testPrompt, false)
        expect(args).to.deep.equal([testPrompt])
      })
    })

    describe('custom executor', () => {
      it('should return echo fallback', () => {
        const { cmd, args } = getExecutorCommand('custom', testPrompt)
        expect(cmd).to.equal('echo')
        expect(args).to.include('Custom executor not configured')
      })
    })

    describe('unknown executor (default)', () => {
      it('should fall back to claude command', () => {
        const { cmd } = getExecutorCommand('unknown-type' as ExecutorType, testPrompt, true)
        expect(cmd).to.equal('claude')
      })
    })

    describe('all executor types', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex', 'custom']

      it('should always return non-empty cmd and args array', () => {
        for (const executor of executors) {
          const result = getExecutorCommand(executor, testPrompt)
          expect(result.cmd).to.be.a('string').with.length.greaterThan(0)
          expect(result.args).to.be.an('array')
        }
      })
    })
  })

  // =========================================================================
  // isClaudeExecutor
  // =========================================================================
  describe('isClaudeExecutor', () => {
    it('should return true for claude-code', () => {
      expect(isClaudeExecutor('claude-code')).to.be.true
    })

    it('should return false for codex', () => {
      expect(isClaudeExecutor('codex')).to.be.false
    })

    it('should return false for custom', () => {
      expect(isClaudeExecutor('custom')).to.be.false
    })
  })

  // =========================================================================
  // getExecutorDisplayName
  // =========================================================================
  describe('getExecutorDisplayName', () => {
    it('should return "Claude Code" for claude-code', () => {
      expect(getExecutorDisplayName('claude-code')).to.equal('Claude Code')
    })

    it('should return "Codex" for codex', () => {
      expect(getExecutorDisplayName('codex')).to.equal('Codex')
    })

    it('should return "Custom" for custom', () => {
      expect(getExecutorDisplayName('custom')).to.equal('Custom')
    })

    it('should fall back to "Claude Code" for unknown type', () => {
      expect(getExecutorDisplayName('unknown' as ExecutorType)).to.equal('Claude Code')
    })
  })

  // =========================================================================
  // getExecutorPackage
  // =========================================================================
  describe('getExecutorPackage', () => {
    it('should return @anthropic-ai/claude-code for claude-code', () => {
      expect(getExecutorPackage('claude-code')).to.equal('@anthropic-ai/claude-code')
    })

    it('should return @openai/codex for codex', () => {
      expect(getExecutorPackage('codex')).to.equal('@openai/codex')
    })

    it('should return null for custom', () => {
      expect(getExecutorPackage('custom')).to.be.null
    })

    it('should fall back to @anthropic-ai/claude-code for unknown type', () => {
      expect(getExecutorPackage('unknown' as ExecutorType)).to.equal('@anthropic-ai/claude-code')
    })
  })

  // =========================================================================
  // runExecutorPreflight
  // =========================================================================
  describe('runExecutorPreflight', () => {
    it('should return ok result for host environment', () => {
      const result = runExecutorPreflight('host', 'claude-code')
      expect(result).to.have.property('ok').that.is.a('boolean')
    })

    it('should return ok result for sandbox environment', () => {
      const result = runExecutorPreflight('sandbox', 'claude-code')
      expect(result).to.have.property('ok').that.is.a('boolean')
    })

    it('should return ok=true for docker without containerId', () => {
      // Docker without containerId skips check
      const result = runExecutorPreflight('docker', 'claude-code')
      expect(result.ok).to.be.true
    })

    it('should return ok=true for cloud', () => {
      const result = runExecutorPreflight('cloud', 'claude-code')
      expect(result.ok).to.be.true
    })

    it('should normalize vm to cloud', () => {
      const result = runExecutorPreflight('vm' as ExecutionEnvironment, 'claude-code')
      expect(result.ok).to.be.true
    })

    it('should include error message when binary not found', () => {
      // Custom executor is 'echo' which should be found, but verifies the structure
      const result = runExecutorPreflight('host', 'custom')
      expect(result).to.have.property('ok')
      if (!result.ok) {
        expect(result).to.have.property('error').that.is.a('string')
      }
    })
  })
})
