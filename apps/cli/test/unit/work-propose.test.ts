import { expect } from 'chai'
import { buildPrompt } from '../../src/lib/execution/runners/prompt-builder.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'
import { buildClaudeStopHookConfig } from '../../src/lib/execution/runners/docker-management.js'

/**
 * PRLT-1129: Regression tests for agent prompt + stop hook routing through prlt primitives.
 *
 * Layer 1: Prompt templates reference `prlt work propose`, not `gh pr create`
 * Layer 2: Stop hook calls `prlt session report` (safety net entry point)
 * Layer 3: Primitives are correctly wired (tested via prompt content)
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-900',
  ticketTitle: 'Test ticket for propose flow',
  ticketDescription: 'Verify propose routing.',
  agentName: 'test-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'TKT-900/feat/test',
  ...overrides,
})

describe('@smoke PRLT-1129: Agent prompt + stop hook routing', () => {
  // =========================================================================
  // Layer 1: Prompt template uses prlt work propose
  // =========================================================================
  describe('Layer 1: Prompt template references prlt work propose', () => {
    it('should include prlt work propose in default required mode with createPR=true', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('prlt work propose TKT-900')
      expect(prompt).to.include('creates a pull request')
    })

    it('should NOT instruct agents to use gh pr create (only warn against it)', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      // Should not contain gh pr create as a command to run
      expect(prompt).to.not.match(/```bash\n\s*gh pr create/)
      // Should warn against using it
      expect(prompt).to.include('do NOT use `gh pr create`')
    })

    it('should include prlt work propose in post review gate mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'post',
      }))
      expect(prompt).to.include('prlt work propose TKT-900')
    })

    it('should use prlt work ready --no-pr when createPR=false in required mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: false,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('prlt work ready TKT-900 --no-pr')
      // Primary instruction should NOT be prlt work propose (it may appear in forbidden commands context)
      expect(prompt).to.not.match(/```bash\n\s*prlt work propose/)
    })

    it('should use prlt work ready --no-pr in auto review gate mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        reviewGate: 'auto',
      }))
      expect(prompt).to.include('prlt work ready TKT-900 --no-pr')
      // Primary instruction should NOT be prlt work propose (it may appear in forbidden commands context)
      expect(prompt).to.not.match(/```bash\n\s*prlt work propose/)
    })

    it('should warn against using gh pr create directly', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('do NOT use `gh pr create`')
    })

    it('should warn against gh pr create in post mode too', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'post',
      }))
      expect(prompt).to.include('do NOT use `gh pr create`')
    })

    it('should still support actionEndPrompt override with TICKET_ID replacement', () => {
      const prompt = buildPrompt(makeContext({
        actionName: 'Custom',
        actionPrompt: 'Do custom work.',
        actionEndPrompt: 'Run `prlt work propose {{TICKET_ID}}`',
        createPR: true,
      }))
      expect(prompt).to.include('prlt work propose TKT-900')
    })
  })

  // =========================================================================
  // Layer 1b: PRLT-1162 — Forbidden commands enforcement
  // =========================================================================
  describe('Layer 1b: PRLT-1162 — Forbidden commands in all modes', () => {
    it('should warn against gh pr merge in required mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('`gh pr merge`')
      expect(prompt).to.include('prlt work ship')
    })

    it('should warn against gh pr create in required mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('`gh pr create`')
      expect(prompt).to.include('prlt work propose')
    })

    it('should warn against gh pr merge in post mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'post',
      }))
      expect(prompt).to.include('`gh pr merge`')
      expect(prompt).to.include('prlt work ship')
    })

    it('should warn against gh pr merge in auto mode', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        reviewGate: 'auto',
      }))
      expect(prompt).to.include('`gh pr merge`')
      expect(prompt).to.include('prlt work ship')
    })

    it('should include forbidden commands block when createPR=false', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: false,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('NEVER use these commands')
      expect(prompt).to.include('`gh pr create`')
      expect(prompt).to.include('`gh pr merge`')
    })
  })

  // =========================================================================
  // Layer 2: Stop hook configuration
  // =========================================================================
  describe('Layer 2: Stop hook calls session report', () => {
    it('should configure stop hook with prlt session report command', () => {
      const config = buildClaudeStopHookConfig()
      expect(config).to.have.property('hooks')
      const hooks = config.hooks as Record<string, unknown[]>
      expect(hooks).to.have.property('Stop')
      expect(hooks.Stop).to.be.an('array').with.length.greaterThan(0)

      const stopHook = hooks.Stop[0] as { matcher: string; hooks: { type: string; command: string }[] }
      expect(stopHook.hooks[0].command).to.include('prlt session report')
      expect(stopHook.hooks[0].command).to.include('--status exited')
    })
  })

  // =========================================================================
  // Layer 3: Primitives referenced in prompts
  // =========================================================================
  describe('Layer 3: Prompt references correct primitives', () => {
    it('should include prlt commit in prompt', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true, createPR: true }))
      expect(prompt).to.include('prlt commit')
    })

    it('should reference prlt work propose for PR creation', () => {
      const prompt = buildPrompt(makeContext({
        modifiesCode: true,
        createPR: true,
        reviewGate: 'required',
      }))
      expect(prompt).to.include('prlt work propose')
    })

    it('should include git push in workflow', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true, createPR: true }))
      expect(prompt).to.include('git push origin HEAD')
    })
  })
})
