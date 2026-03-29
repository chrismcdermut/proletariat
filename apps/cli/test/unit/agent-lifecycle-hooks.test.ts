import { expect } from 'chai'
import {
  buildClaudeLifecycleHooks,
  buildClaudeStopHookConfig,
} from '../../src/lib/execution/runners/docker-management.js'
import { buildPrompt, buildTicketOperationsGuidance } from '../../src/lib/execution/runners/prompt-builder.js'
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
          expect(entry).to.have.property('matcher', '', `${hookName} must have matcher field`)
          expect(entry).to.have.property('hooks').that.is.an('array', `${hookName} must use hooks array`)
          // Regression: old format had type/command at same level as array entries
          expect(entry).to.not.have.property('type', `${hookName} must not have flat type`)
          expect(entry).to.not.have.property('command', `${hookName} must not have flat command`)
        }
      }
    })

    it('should have all hooks use error-suppressed commands', () => {
      const config = buildClaudeLifecycleHooks() as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
      }
      for (const [hookName, entries] of Object.entries(config.hooks)) {
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

    it('should require confirmation for agent spawn actions', () => {
      const preset = getPreset('supervised')
      const spawnHooks = preset.hooks.filter(h => h.action === 'spawn-agent' || h.action === 'respawn')
      for (const hook of spawnHooks) {
        expect(hook.mode).to.equal('confirm',
          `${hook.action} should require confirmation in supervised mode`)
      }
    })
  })
})
