import { expect } from 'chai'
import {
  buildClaudeLifecycleHooks,
  buildClaudeStopHookConfig,
  buildEnforceTestsHookScript,
} from '../../src/lib/execution/runners/docker-management.js'
import { buildPrompt, buildTicketOperationsGuidance, buildTestEnforcementGuidance } from '../../src/lib/execution/runners/prompt-builder.js'
import { PRESETS, getPreset } from '../../src/lib/orchestrate/presets.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

/**
 * Regression tests for PRLT-1224: Wire up agent lifecycle hooks.
 *
 * Three layers must work together:
 * 1. Claude Code hooks in containers (Start/Stop/SubagentStop)
 * 2. Role prompt guidance (prlt commands for ticket ops)
 * 3. Daemon preset hooks (agent lifecycle → ticket transitions)
 */

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    ticketId: 'PRLT-1224',
    ticketTitle: 'Test ticket',
    ticketDescription: 'Test description',
    agentName: 'test-agent',
    agentDir: '/tmp/test-agent',
    worktreePath: '/tmp/test-agent/repo',
    branch: 'PRLT-1224/feat/test',
    ...overrides,
  }
}

// =============================================================================
// Layer 1: Claude Code Lifecycle Hooks
// =============================================================================

describe('PRLT-1224: Layer 1 — Claude Code lifecycle hooks', () => {
  describe('buildClaudeLifecycleHooks', () => {
    it('should include Start hook that moves ticket to in-progress', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      expect(config.hooks).to.have.property('Start')
      expect(config.hooks.Start).to.be.an('array').with.lengthOf(1)

      const startHook = config.hooks.Start[0]
      expect(startHook).to.have.property('matcher')
      expect(startHook.hooks[0].command).to.include('prlt ticket move')
      expect(startHook.hooks[0].command).to.include('in-progress')
      expect(startHook.hooks[0].command).to.include('PRLT_TICKET_ID')
    })

    it('should include Stop hook that calls session report', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      expect(config.hooks).to.have.property('Stop')
      expect(config.hooks.Stop).to.be.an('array').with.lengthOf(1)

      const stopHook = config.hooks.Stop[0]
      expect(stopHook.hooks[0].command).to.include('prlt session report')
      expect(stopHook.hooks[0].command).to.include('--status exited')
    })

    it('should include SubagentStop hook for sub-agent lifecycle', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      expect(config.hooks).to.have.property('SubagentStop')
      expect(config.hooks.SubagentStop).to.be.an('array').with.lengthOf(1)

      const subagentHook = config.hooks.SubagentStop[0]
      expect(subagentHook.hooks[0].command).to.include('prlt session report')
    })

    it('should use matcher+hooks array format (PRLT-1082 regression)', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: unknown[] }>>
      }
      for (const [hookName, entries] of Object.entries(config.hooks)) {
        for (const entry of entries) {
          expect(entry).to.have.property('matcher').that.is.a('string', `${hookName} must have matcher field`)
          expect(entry).to.have.property('hooks').that.is.an('array', `${hookName} must use hooks array`)
          // Regression: old format had type/command at same level as array entries
          expect(entry).to.not.have.property('type', `${hookName} must not have flat type`)
          expect(entry).to.not.have.property('command', `${hookName} must not have flat command`)
        }
      }
    })

    it('should have lifecycle hooks use error-suppressed commands', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
      }
      // Only lifecycle hooks (Start/Stop/SubagentStop) need error suppression.
      // PreToolUse hooks are scripts that handle their own exit codes.
      const lifecycleHooks = ['Start', 'Stop', 'SubagentStop']
      for (const hookName of lifecycleHooks) {
        const entries = config.hooks[hookName]
        for (const entry of entries) {
          for (const hook of entry.hooks) {
            expect(hook.command).to.include('|| true',
              `${hookName} hook must suppress errors to avoid blocking Claude Code`)
          }
        }
      }
    })
  })

  describe('buildClaudeStopHookConfig (backward compat)', () => {
    it('should delegate to buildClaudeLifecycleHooks', () => {
      const legacy = buildClaudeStopHookConfig()
      const modern = buildClaudeLifecycleHooks()
      expect(legacy).to.deep.equal(modern)
    })
  })
})

// =============================================================================
// Layer 2: Role Prompt Guidance
// =============================================================================

describe('PRLT-1224: Layer 2 — Role prompt guidance', () => {
  describe('buildTicketOperationsGuidance', () => {
    it('should include prlt ticket move command', () => {
      const guidance = buildTicketOperationsGuidance()
      expect(guidance).to.include('prlt ticket move')
    })

    it('should include prlt ticket comment command', () => {
      const guidance = buildTicketOperationsGuidance()
      expect(guidance).to.include('prlt ticket comment')
    })

    it('should include prlt commit command', () => {
      const guidance = buildTicketOperationsGuidance()
      expect(guidance).to.include('prlt commit')
    })

    it('should include prlt work propose command', () => {
      const guidance = buildTicketOperationsGuidance()
      expect(guidance).to.include('prlt work propose')
    })

    it('should warn against raw API calls', () => {
      const guidance = buildTicketOperationsGuidance()
      expect(guidance).to.include('NEVER')
      expect(guidance).to.include('curl')
    })
  })

  describe('buildPrompt injects guidance', () => {
    it('should include ticket operations guidance in agent prompts', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true }))
      expect(prompt).to.include('Ticket Operations')
      expect(prompt).to.include('prlt ticket move')
    })

    it('should not inject guidance into orchestrator prompts', () => {
      const prompt = buildPrompt(makeContext({ isOrchestrator: true }))
      // Orchestrator has its own command reference
      expect(prompt).to.not.include('## Ticket Operations')
    })
  })
})

// =============================================================================
// Layer 3: Daemon Preset Hooks
// =============================================================================

describe('PRLT-1224: Layer 3 — Daemon preset lifecycle hooks', () => {
  describe('agent lifecycle transitions', () => {
    it('should have on_agent_spawned → move-ticket in-progress', () => {
      const preset = getPreset('aggressive')
      const hook = preset.hooks.find(h => h.event === 'on_agent_spawned' && h.action === 'move-ticket')
      expect(hook).to.exist
      expect(hook!.config).to.deep.include({ target: 'in-progress' })
    })

    it('should have on_agent_completed → move-ticket review', () => {
      const preset = getPreset('aggressive')
      const hook = preset.hooks.find(h => h.event === 'on_agent_completed' && h.action === 'move-ticket')
      expect(hook).to.exist
      expect(hook!.config).to.deep.include({ target: 'review' })
    })

    it('should have on_agent_died → move-ticket ready', () => {
      const preset = getPreset('aggressive')
      const hook = preset.hooks.find(h => h.event === 'on_agent_died' && h.action === 'move-ticket')
      expect(hook).to.exist
      expect(hook!.config).to.deep.include({ target: 'ready' })
    })

    it('should have on_pr_merged → move-ticket done', () => {
      const preset = getPreset('aggressive')
      const hook = preset.hooks.find(h => h.event === 'on_pr_merged' && h.action === 'move-ticket')
      expect(hook).to.exist
      expect(hook!.config).to.deep.include({ target: 'done' })
    })
  })

  describe('full lifecycle loop present in all presets', () => {
    const LIFECYCLE_HOOKS = [
      { event: 'on_agent_spawned', action: 'move-ticket', target: 'in-progress' },
      { event: 'on_agent_completed', action: 'move-ticket', target: 'review' },
      { event: 'on_agent_died', action: 'move-ticket', target: 'ready' },
      { event: 'on_pr_merged', action: 'move-ticket', target: 'done' },
    ]

    for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
      it(`${presetName} preset covers all lifecycle transitions`, () => {
        const preset = getPreset(presetName)
        for (const expected of LIFECYCLE_HOOKS) {
          const hook = preset.hooks.find(h =>
            h.event === expected.event &&
            h.action === expected.action &&
            (h.config as Record<string, unknown>)?.target === expected.target
          )
          expect(hook).to.exist,
            `Missing ${expected.event} → ${expected.action} (target: ${expected.target}) in ${presetName}`
        }
      })
    }
  })

  describe('supervised preset mode assignments', () => {
    it('should auto-execute move-ticket for agent lifecycle events', () => {
      const preset = getPreset('supervised')
      const moveHooks = preset.hooks.filter(h => h.action === 'move-ticket')
      for (const hook of moveHooks) {
        expect(hook.mode).to.equal('auto',
          `move-ticket should be auto in supervised mode for ${hook.event}`)
      }
    })

    it('should require LLM approval for agent spawn actions', () => {
      const preset = getPreset('supervised')
      const spawnHooks = preset.hooks.filter(h => h.action === 'spawn-agent' || h.action === 'respawn')
      for (const hook of spawnHooks) {
        expect(hook.mode).to.equal('llm',
          `${hook.action} should require LLM approval in supervised mode`)
      }
    })
  })
})

// =============================================================================
// PRLT-1225: Test Enforcement — PreToolUse Hook + Prompt Guidance
// =============================================================================

describe('PRLT-1225: Layer 1 — PreToolUse hook for test enforcement', () => {
  describe('buildClaudeLifecycleHooks includes PreToolUse', () => {
    it('should include a PreToolUse hook entry', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      expect(config.hooks).to.have.property('PreToolUse')
      expect(config.hooks.PreToolUse).to.be.an('array').with.lengthOf(1)
    })

    it('should match only Bash tool', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      const preToolUse = config.hooks.PreToolUse[0]
      expect(preToolUse.matcher).to.equal('Bash')
    })

    it('should reference the enforce-tests hook script', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      const hook = config.hooks.PreToolUse[0].hooks[0]
      expect(hook.type).to.equal('command')
      expect(hook.command).to.include('enforce-tests.sh')
    })

    it('should point to the container hooks directory', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>
      }
      const hook = config.hooks.PreToolUse[0].hooks[0]
      expect(hook.command).to.equal('/home/node/.claude/hooks/enforce-tests.sh')
    })
  })

  describe('buildEnforceTestsHookScript', () => {
    let script: string

    before(() => {
      script = buildEnforceTestsHookScript()
    })

    it('should start with a shebang', () => {
      expect(script).to.match(/^#!/)
      expect(script).to.include('#!/bin/bash')
    })

    it('should read stdin for tool input', () => {
      expect(script).to.include('INPUT=$(cat)')
    })

    it('should check for gh pr create commands', () => {
      expect(script).to.include('gh pr create')
    })

    it('should check for git push commands', () => {
      expect(script).to.include('git push')
    })

    it('should check for prlt work propose commands', () => {
      expect(script).to.include('prlt work propose')
    })

    it('should check for prlt pr create commands', () => {
      expect(script).to.include('prlt pr create')
    })

    it('should exit early for non-matching commands', () => {
      // The case statement should exit 0 for non-matching commands
      expect(script).to.include('exit 0')
    })

    it('should use git diff to check for test files', () => {
      expect(script).to.include('git diff --name-only')
      expect(script).to.include('origin/main...HEAD')
    })

    it('should match test file patterns (.test.ts, .spec.ts, etc)', () => {
      // Script uses grep -iE with extended regex: \.(test|spec)\.(ts|js|tsx|jsx)$
      expect(script).to.include('.test')
      expect(script).to.include('.spec')
      expect(script).to.include('ts|js|tsx|jsx')
    })

    it('should output hookSpecificOutput JSON when no tests found', () => {
      expect(script).to.include('hookSpecificOutput')
      expect(script).to.include('PreToolUse')
      expect(script).to.include('permissionDecision')
      expect(script).to.include('allow')
      expect(script).to.include('additionalContext')
    })

    it('should warn about missing tests in the additionalContext', () => {
      expect(script).to.include('No test files')
      expect(script).to.include('MUST include tests')
    })

    it('should allow (not block) the command even when no tests found', () => {
      // The hook warns but does not block — permissionDecision is "allow"
      expect(script).to.include('"permissionDecision":"allow"')
    })

    it('should always exit 0 (never block the tool)', () => {
      // Script must not exit with code 2 (which would block)
      expect(script).to.not.include('exit 2')
      expect(script).to.not.include('exit 1')
    })
  })
})

describe('PRLT-1225: Layer 2 — Role prompt test enforcement guidance', () => {
  describe('buildTestEnforcementGuidance', () => {
    let guidance: string

    before(() => {
      guidance = buildTestEnforcementGuidance()
    })

    it('should include a mandatory heading', () => {
      expect(guidance).to.include('Test Requirements')
      expect(guidance).to.include('MANDATORY')
    })

    it('should require unit tests for new functions', () => {
      expect(guidance).to.include('unit tests')
    })

    it('should require integration/e2e tests for new flows', () => {
      expect(guidance).to.include('integration')
    })

    it('should mention test file locations', () => {
      expect(guidance).to.include('test/unit/')
      expect(guidance).to.include('test/e2e/')
    })

    it('should mention the pre-commit hook as enforcement', () => {
      expect(guidance).to.include('pre-commit hook')
    })

    it('should tell agents to run tests before committing', () => {
      expect(guidance).to.include('pnpm test:unit')
    })
  })

  describe('buildPrompt injects test guidance', () => {
    it('should include test guidance when modifiesCode is true', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true }))
      expect(prompt).to.include('Test Requirements')
      expect(prompt).to.include('MUST include tests')
    })

    it('should NOT include test guidance when modifiesCode is false', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: false }))
      expect(prompt).to.not.include('Test Requirements (MANDATORY)')
    })

    it('should NOT include test guidance when modifiesCode is undefined', () => {
      const prompt = buildPrompt(makeContext())
      expect(prompt).to.not.include('Test Requirements (MANDATORY)')
    })

    it('should NOT include test guidance in orchestrator prompts', () => {
      const prompt = buildPrompt(makeContext({ isOrchestrator: true, modifiesCode: true }))
      expect(prompt).to.not.include('Test Requirements (MANDATORY)')
    })
  })
})
