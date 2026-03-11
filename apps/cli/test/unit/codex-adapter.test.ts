import { expect } from 'chai'

import {
  getCodexCommand,
  getCodexCommandFromConfig,
  resolveCodexExecutionContext,
  validateCodexMode,
  CodexModeError,
} from '../../src/lib/execution/codex-adapter.js'
import type { CodexExecutionContext } from '../../src/lib/execution/codex-adapter.js'
import type { DisplayMode, OutputMode, PermissionMode } from '../../src/lib/execution/types.js'

/**
 * Unit tests for the Codex runtime adapter (TKT-1167).
 *
 * Verifies that Codex executor behavior is deterministic by permission mode
 * and execution context, and that unsupported combinations fail with
 * actionable error messages.
 *
 * Updated for Codex v0.104.0 flags (TKT-080):
 *   - danger mode: --dangerously-bypass-approvals-and-sandbox
 *   - safe mode: --full-auto
 *   - non-tty: codex exec subcommand
 */
describe('Codex Runtime Adapter (TKT-1167)', () => {
  const testPrompt = 'Implement the feature described in the ticket'

  // ===========================================================================
  // resolveCodexExecutionContext
  // ===========================================================================

  describe('resolveCodexExecutionContext', () => {
    it('should resolve terminal + interactive to interactive', () => {
      expect(resolveCodexExecutionContext('terminal', 'interactive')).to.equal('interactive')
    })

    it('should resolve foreground + interactive to interactive', () => {
      expect(resolveCodexExecutionContext('foreground', 'interactive')).to.equal('interactive')
    })

    it('should resolve background + interactive to background', () => {
      expect(resolveCodexExecutionContext('background', 'interactive')).to.equal('background')
    })

    it('should resolve background + print to background', () => {
      expect(resolveCodexExecutionContext('background', 'print')).to.equal('background')
    })

    it('should resolve terminal + print to non-tty', () => {
      expect(resolveCodexExecutionContext('terminal', 'print')).to.equal('non-tty')
    })

    it('should resolve foreground + print to non-tty', () => {
      expect(resolveCodexExecutionContext('foreground', 'print')).to.equal('non-tty')
    })
  })

  // ===========================================================================
  // validateCodexMode
  // ===========================================================================

  describe('validateCodexMode', () => {
    describe('danger mode (all contexts valid)', () => {
      const contexts: CodexExecutionContext[] = ['interactive', 'background', 'non-tty']

      for (const ctx of contexts) {
        it(`should allow danger + ${ctx}`, () => {
          expect(validateCodexMode('danger', ctx)).to.be.null
        })
      }
    })

    describe('safe mode', () => {
      it('should allow safe + interactive', () => {
        expect(validateCodexMode('safe', 'interactive')).to.be.null
      })

      it('should reject safe + background with CodexModeError', () => {
        const error = validateCodexMode('safe', 'background')
        expect(error).to.be.instanceOf(CodexModeError)
        expect(error!.permissionMode).to.equal('safe')
        expect(error!.executionContext).to.equal('background')
      })

      it('should reject safe + non-tty with CodexModeError', () => {
        const error = validateCodexMode('safe', 'non-tty')
        expect(error).to.be.instanceOf(CodexModeError)
        expect(error!.permissionMode).to.equal('safe')
        expect(error!.executionContext).to.equal('non-tty')
      })
    })

    describe('error messages are actionable', () => {
      it('should mention TTY requirement in background error', () => {
        const error = validateCodexMode('safe', 'background')
        expect(error).to.not.be.null
        expect(error!.message).to.include('TTY')
        expect(error!.message).to.include('danger mode')
      })

      it('should mention TTY requirement in non-tty error', () => {
        const error = validateCodexMode('safe', 'non-tty')
        expect(error).to.not.be.null
        expect(error!.message).to.include('TTY')
        expect(error!.message).to.include('danger mode')
      })

      it('should suggest using danger mode as alternative', () => {
        const error = validateCodexMode('safe', 'background')
        expect(error!.message).to.include('danger mode')
      })

      it('should suggest running in a terminal as alternative', () => {
        const error = validateCodexMode('safe', 'non-tty')
        expect(error!.message).to.include('terminal')
      })
    })
  })

  // ===========================================================================
  // getCodexCommand
  // ===========================================================================

  describe('getCodexCommand', () => {
    describe('danger mode', () => {
      it('should return codex --dangerously-bypass-approvals-and-sandbox <prompt> for danger + interactive', () => {
        const result = getCodexCommand(testPrompt, 'danger', 'interactive')
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--dangerously-bypass-approvals-and-sandbox', testPrompt])
        expect(result.dangerMode).to.be.true
        expect(result.executionContext).to.equal('interactive')
      })

      it('should return codex --dangerously-bypass-approvals-and-sandbox <prompt> for danger + background', () => {
        const result = getCodexCommand(testPrompt, 'danger', 'background')
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--dangerously-bypass-approvals-and-sandbox', testPrompt])
        expect(result.dangerMode).to.be.true
      })

      it('should return codex exec --dangerously-bypass-approvals-and-sandbox <prompt> for danger + non-tty', () => {
        const result = getCodexCommand(testPrompt, 'danger', 'non-tty')
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['exec', '--dangerously-bypass-approvals-and-sandbox', testPrompt])
        expect(result.dangerMode).to.be.true
      })
    })

    describe('safe mode', () => {
      it('should return codex --full-auto <prompt> for safe + interactive', () => {
        const result = getCodexCommand(testPrompt, 'safe', 'interactive')
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--full-auto', testPrompt])
        expect(result.dangerMode).to.be.false
        expect(result.executionContext).to.equal('interactive')
      })

      it('should throw CodexModeError for safe + background', () => {
        expect(() => getCodexCommand(testPrompt, 'safe', 'background'))
          .to.throw(CodexModeError)
      })

      it('should throw CodexModeError for safe + non-tty', () => {
        expect(() => getCodexCommand(testPrompt, 'safe', 'non-tty'))
          .to.throw(CodexModeError)
      })
    })

    describe('deterministic behavior', () => {
      it('should produce identical output for identical inputs', () => {
        const r1 = getCodexCommand(testPrompt, 'danger', 'interactive')
        const r2 = getCodexCommand(testPrompt, 'danger', 'interactive')
        expect(r1).to.deep.equal(r2)
      })

      it('should produce identical output for safe + interactive repeated calls', () => {
        const r1 = getCodexCommand(testPrompt, 'safe', 'interactive')
        const r2 = getCodexCommand(testPrompt, 'safe', 'interactive')
        expect(r1).to.deep.equal(r2)
      })

      it('should always use codex binary (never claude)', () => {
        const modes: Array<[PermissionMode, CodexExecutionContext]> = [
          ['danger', 'interactive'],
          ['danger', 'background'],
          ['danger', 'non-tty'],
          ['safe', 'interactive'],
        ]
        for (const [perm, ctx] of modes) {
          const result = getCodexCommand(testPrompt, perm, ctx)
          expect(result.cmd).to.equal('codex')
        }
      })
    })

    describe('prompt handling', () => {
      it('should handle prompts with single quotes', () => {
        const prompt = "Build the user's profile page"
        const result = getCodexCommand(prompt, 'danger', 'interactive')
        expect(result.args).to.include(prompt)
      })

      it('should handle prompts with double quotes', () => {
        const prompt = 'Build the "profile" page'
        const result = getCodexCommand(prompt, 'danger', 'interactive')
        expect(result.args).to.include(prompt)
      })

      it('should handle prompts with newlines', () => {
        const prompt = 'Step 1: Build\nStep 2: Test'
        const result = getCodexCommand(prompt, 'danger', 'interactive')
        expect(result.args).to.include(prompt)
      })

      it('should handle empty prompts', () => {
        const result = getCodexCommand('', 'danger', 'interactive')
        expect(result.cmd).to.equal('codex')
        expect(result.args).to.deep.equal(['--dangerously-bypass-approvals-and-sandbox', ''])
      })
    })
  })

  // ===========================================================================
  // getCodexCommandFromConfig
  // ===========================================================================

  describe('getCodexCommandFromConfig', () => {
    it('should map sandboxed=false to danger mode with --dangerously-bypass-approvals-and-sandbox', () => {
      const result = getCodexCommandFromConfig(testPrompt, false, 'terminal', 'interactive')
      expect(result.dangerMode).to.be.true
      expect(result.args).to.include('--dangerously-bypass-approvals-and-sandbox')
    })

    it('should map sandboxed=true to safe mode with --full-auto', () => {
      const result = getCodexCommandFromConfig(testPrompt, true, 'terminal', 'interactive')
      expect(result.dangerMode).to.be.false
      expect(result.args).to.include('--full-auto')
    })

    it('should throw for sandboxed=true + background display', () => {
      expect(() => getCodexCommandFromConfig(testPrompt, true, 'background', 'interactive'))
        .to.throw(CodexModeError)
    })

    it('should succeed for sandboxed=false + background display', () => {
      const result = getCodexCommandFromConfig(testPrompt, false, 'background', 'interactive')
      expect(result.cmd).to.equal('codex')
      expect(result.dangerMode).to.be.true
    })

    it('should throw for sandboxed=true + print output mode', () => {
      expect(() => getCodexCommandFromConfig(testPrompt, true, 'terminal', 'print'))
        .to.throw(CodexModeError)
    })

    it('should succeed for sandboxed=false + print output mode', () => {
      const result = getCodexCommandFromConfig(testPrompt, false, 'terminal', 'print')
      expect(result.cmd).to.equal('codex')
      expect(result.dangerMode).to.be.true
    })

    it('should use default displayMode=terminal and outputMode=interactive', () => {
      const result = getCodexCommandFromConfig(testPrompt, true)
      expect(result.cmd).to.equal('codex')
      expect(result.dangerMode).to.be.false
      expect(result.executionContext).to.equal('interactive')
    })
  })

  // ===========================================================================
  // CodexModeError
  // ===========================================================================

  describe('CodexModeError', () => {
    it('should have name CodexModeError', () => {
      const error = new CodexModeError('safe', 'background')
      expect(error.name).to.equal('CodexModeError')
    })

    it('should be instanceof Error', () => {
      const error = new CodexModeError('safe', 'background')
      expect(error).to.be.instanceOf(Error)
    })

    it('should preserve permissionMode and executionContext', () => {
      const error = new CodexModeError('safe', 'non-tty')
      expect(error.permissionMode).to.equal('safe')
      expect(error.executionContext).to.equal('non-tty')
    })

    it('should have a descriptive message', () => {
      const error = new CodexModeError('safe', 'background')
      expect(error.message).to.be.a('string')
      expect(error.message.length).to.be.greaterThan(20)
    })
  })

  // ===========================================================================
  // Complete mode matrix
  // ===========================================================================

  describe('complete mode matrix', () => {
    const permissionModes: PermissionMode[] = ['danger', 'safe']
    const executionContexts: CodexExecutionContext[] = ['interactive', 'background', 'non-tty']

    // Expected: only safe+background and safe+non-tty should fail
    const unsupportedCombos = new Set(['safe:background', 'safe:non-tty'])

    for (const perm of permissionModes) {
      for (const ctx of executionContexts) {
        const key = `${perm}:${ctx}`
        const shouldFail = unsupportedCombos.has(key)

        it(`${perm} + ${ctx} should ${shouldFail ? 'fail' : 'succeed'}`, () => {
          if (shouldFail) {
            expect(() => getCodexCommand(testPrompt, perm, ctx)).to.throw(CodexModeError)
          } else {
            const result = getCodexCommand(testPrompt, perm, ctx)
            expect(result.cmd).to.equal('codex')
          }
        })
      }
    }
  })
})
