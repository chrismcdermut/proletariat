import { expect } from 'chai'

import {
  buildDockerImage,
  createDockerContainer,
  type SpawnStageError,
} from '../../src/lib/execution/runners/docker-management.js'

import {
  KNOWN_PROMPT_PATTERNS,
  detectPrompt,
  resolveKeyToSend,
} from '../../src/lib/execution/prompt-watcher.js'

import {
  DEFAULT_EXECUTION_CONFIG,
  ExecutionContext,
} from '../../src/lib/execution/types.js'

/**
 * Unit tests for PRLT-1322 Docker spawn pipeline fixes.
 *
 * Covers:
 * - Stage error surfacing from buildDockerImage / createDockerContainer
 * - Theme / shell-integration / workspace-trust prompt patterns
 * - SpawnStageError shape
 */
describe('Docker Spawn Pipeline (PRLT-1322)', () => {
  // =========================================================================
  // Stage error surfacing — buildDockerImage
  // =========================================================================
  describe('buildDockerImage stage errors', () => {
    it('returns false and sets image-build stage error when Dockerfile is missing', () => {
      const errorOut: { error?: SpawnStageError } = {}
      const ok = buildDockerImage('/does/not/exist', 'prlt-agent-nonexistent:latest', {}, errorOut)
      expect(ok).to.equal(false)
      expect(errorOut.error).to.exist
      expect(errorOut.error!.stage).to.equal('image-build')
      expect(errorOut.error!.message).to.match(/Dockerfile not found/)
    })

    it('leaves errorOut empty when errorOut is not provided', () => {
      // Regression: signature accepts an optional errorOut; passing undefined
      // must not throw and should still return false cleanly.
      const ok = buildDockerImage('/does/not/exist', 'prlt-agent-nonexistent:latest', {})
      expect(ok).to.equal(false)
    })
  })

  // =========================================================================
  // Stage error surfacing — createDockerContainer
  // =========================================================================
  describe('createDockerContainer stage errors', () => {
    it('returns false and reports container-create stage when docker run fails', () => {
      // Build a synthetic context pointing at a non-existent image.
      const context: ExecutionContext = {
        ticketId: 'PRLT-TEST',
        ticketTitle: 'test ticket',
        agentName: 'prlt-test-agent-does-not-exist',
        agentDir: '/tmp/prlt-test-agent-does-not-exist',
        worktreePath: '/tmp/prlt-test-agent-does-not-exist',
        branch: 'PRLT-TEST/feat/test',
        actionName: 'test',
      }
      const errorOut: { error?: SpawnStageError } = {}
      const ok = createDockerContainer(
        context,
        'prlt-agent-prlt-test-agent-does-not-exist',
        'prlt-agent-prlt-test-agent-does-not-exist:does-not-exist',
        DEFAULT_EXECUTION_CONFIG,
        'claude-code',
        undefined,
        errorOut,
      )
      expect(ok).to.equal(false)
      if (errorOut.error) {
        // If docker is available on the runner, errorOut is populated with the stage.
        expect(errorOut.error.stage).to.equal('container-create')
      }
    })
  })

  // =========================================================================
  // Claude onboarding prompt patterns (theme, shell, trust)
  // =========================================================================
  describe('KNOWN_PROMPT_PATTERNS — Claude onboarding coverage', () => {
    it('includes a pattern for Claude Code theme selection', () => {
      const match = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-theme-selection')
      expect(match).to.exist
      expect(match!.headerMatch).to.equal('Choose the text style that looks best')
      expect(match!.preferredOption).to.equal('Dark mode')
    })

    it('includes a pattern for Claude Code shell integration prompt', () => {
      const match = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-shell-integration')
      expect(match).to.exist
      expect(match!.headerMatch.toLowerCase()).to.include('shell integration')
    })

    it('includes a pattern for Claude Code workspace trust dialog', () => {
      const match = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-workspace-trust')
      expect(match).to.exist
      expect(match!.headerMatch).to.match(/trust/i)
    })
  })

  describe('detectPrompt — theme pattern', () => {
    it('detects the Claude theme selection menu and picks option 1', () => {
      const pane = [
        'Welcome to Claude Code',
        '',
        'Choose the text style that looks best with your terminal:',
        '',
        '❯ 1. Dark mode',
        '  2. Light mode',
        '  3. Dark mode (colorblind-friendly)',
      ].join('\n')

      const detection = detectPrompt(pane)
      expect(detection).to.exist
      expect(detection!.pattern.name).to.equal('claude-theme-selection')

      const resolution = resolveKeyToSend(pane, detection!.pattern)
      expect(resolution).to.exist
      expect(resolution!.key).to.equal('1')
      expect(resolution!.optionText).to.equal('Dark mode')
    })
  })
})
