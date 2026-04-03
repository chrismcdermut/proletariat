import { expect } from 'chai'
import { buildDevcontainerCommand } from '../../src/lib/execution/runners/devcontainer.js'
import { buildClaudeLifecycleHooks, buildEnforceTestsHookScript } from '../../src/lib/execution/runners/docker-management.js'
import { getCCAppPermissionSettings } from '../../src/lib/execution/cc-version.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

/**
 * Regression tests for PRLT-1240: Container agents stuck at bypass permissions prompt.
 *
 * Claude Code 2.1.86+ overwrites ~/.claude.json on startup, clobbering our onboarding
 * settings. The fix is to use -p (print) mode which skips ALL onboarding prompts.
 *
 * These tests verify:
 * 1. Container commands always use -p flag (not conditional on outputMode)
 * 2. Container setup writes settings.json but NOT .claude.json
 * 3. Version pin (CC_DEFAULT_VERSION) is no longer exported
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-1240',
  ticketTitle: 'Print mode regression test',
  agentName: 'test-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/agent/repo',
  branch: 'PRLT-1240/fix/test',
  ...overrides,
})

describe('Regression: PRLT-1240 — container print mode', () => {
  const promptFile = '/workspace/repo/.prlt-prompt.txt'
  const containerId = 'abc123'

  // ===========================================================================
  // 1. -p flag is ALWAYS present in container commands
  // ===========================================================================
  describe('devcontainer command always uses -p flag', () => {
    it('should include -p for interactive output mode', () => {
      const cmd = buildDevcontainerCommand(
        makeContext(), 'claude-code', promptFile, containerId,
        'interactive', 'danger', 'terminal'
      )
      expect(cmd).to.include('-p ')
    })

    it('should include -p for print output mode', () => {
      const cmd = buildDevcontainerCommand(
        makeContext(), 'claude-code', promptFile, containerId,
        'print', 'danger', 'background'
      )
      expect(cmd).to.include('-p ')
    })

    it('should include -p for safe permission mode', () => {
      const cmd = buildDevcontainerCommand(
        makeContext(), 'claude-code', promptFile, containerId,
        'interactive', 'safe', 'terminal'
      )
      expect(cmd).to.include('-p ')
    })

    it('should include -p for background display mode', () => {
      const cmd = buildDevcontainerCommand(
        makeContext(), 'claude-code', promptFile, containerId,
        'interactive', 'danger', 'background'
      )
      expect(cmd).to.include('-p ')
    })

    it('should NOT include -p for non-claude executors', () => {
      const cmd = buildDevcontainerCommand(
        makeContext(), 'codex', promptFile, containerId,
        'interactive', 'danger', 'background'
      )
      expect(cmd).to.not.include('-p ')
    })
  })

  // ===========================================================================
  // 2. settings.json is still written (not .claude.json)
  // ===========================================================================
  describe('settings.json generation', () => {
    it('getCCAppPermissionSettings should return skipDangerousModePermissionPrompt', () => {
      const settings = getCCAppPermissionSettings()
      expect(settings.skipDangerousModePermissionPrompt).to.be.true
    })

    it('getCCAppPermissionSettings should include dangerouslySkipPermissions for unknown version', () => {
      // When version is undefined, forward-compat writes both old and new keys
      const settings = getCCAppPermissionSettings()
      expect(settings.dangerouslySkipPermissions).to.be.true
    })

    it('lifecycle hooks should be mergeable with app permission settings', () => {
      const appSettings = getCCAppPermissionSettings()
      const hooks = buildClaudeLifecycleHooks()
      const merged: Record<string, unknown> = { ...appSettings, ...hooks }

      // Both permission and hook settings should be present
      expect(merged.skipDangerousModePermissionPrompt).to.be.true
      expect(merged).to.have.property('hooks')
      const mergedHooks = merged.hooks as Record<string, unknown[]>
      expect(mergedHooks).to.have.property('Stop')
      expect(mergedHooks).to.have.property('Start')
    })
  })

  // ===========================================================================
  // 3. CC_DEFAULT_VERSION is no longer exported
  // ===========================================================================
  describe('version pin removal', () => {
    it('should NOT export CC_DEFAULT_VERSION from cc-version module', async () => {
      const ccVersionModule = await import('../../src/lib/execution/cc-version.js')
      expect(ccVersionModule).to.not.have.property('CC_DEFAULT_VERSION')
    })
  })

  // ===========================================================================
  // 4. Enforce-tests hook is still generated correctly
  // ===========================================================================
  describe('enforce-tests hook', () => {
    it('should generate a valid bash script', () => {
      const script = buildEnforceTestsHookScript()
      expect(script).to.include('#!/bin/bash')
      expect(script).to.include('PRLT-1225')
    })

    it('should check for test file patterns', () => {
      const script = buildEnforceTestsHookScript()
      expect(script).to.include('.test.')
      expect(script).to.include('.spec.')
    })
  })
})
