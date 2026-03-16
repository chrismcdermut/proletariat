import { expect } from 'chai'
import {
  buildPrompt,
  buildOrchestratorSystemPrompt,
  buildIntegrationCommandsSection,
} from '../../src/lib/execution/runners/prompt-builder.js'
import {
  getExecutorCommand,
  isClaudeExecutor,
} from '../../src/lib/execution/runners/executor.js'
import { buildDevcontainerCommand } from '../../src/lib/execution/runners/devcontainer.js'
import type { ExecutionContext, ExecutorType } from '../../src/lib/execution/types.js'

/**
 * Prompt delivery integration test — verifies the full path from ticket context
 * through prompt building to executor command generation.
 *
 * TKT-140: At least one integration test for prompt delivery.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-300',
  ticketTitle: 'Add retry logic to API client',
  ticketDescription: 'Implement exponential backoff with jitter for failed HTTP requests.',
  ticketPriority: 'P1',
  ticketCategory: 'feature',
  agentName: 'fast-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/agent/repo',
  branch: 'TKT-300/feat/chris/fast-agent/add-retry-logic',
  modifiesCode: true,
  createPR: true,
  ...overrides,
})

describe('Prompt Delivery Integration (TKT-140)', () => {
  // =========================================================================
  // Full ticket → prompt → command pipeline
  // =========================================================================
  describe('end-to-end: ticket context → prompt → executor command', () => {
    it('should produce a valid prompt from ticket context and pass it to executor', () => {
      const ctx = makeContext()

      // Step 1: Build prompt from ticket context
      const prompt = buildPrompt(ctx)
      expect(prompt).to.be.a('string').with.length.greaterThan(100)

      // Verify prompt contains all ticket information
      expect(prompt).to.include('TKT-300')
      expect(prompt).to.include('Add retry logic to API client')
      expect(prompt).to.include('exponential backoff')
      expect(prompt).to.include('P1')
      expect(prompt).to.include('feature')

      // Step 2: Build executor command with the prompt
      const { cmd, args } = getExecutorCommand('claude-code', prompt, true)
      expect(cmd).to.equal('claude')
      expect(args).to.include(prompt)
      expect(args).to.include('--dangerously-skip-permissions')
    })

    it('should produce a valid devcontainer command with prompt file', () => {
      const ctx = makeContext()

      // Build prompt
      const prompt = buildPrompt(ctx)
      expect(prompt).to.include('TKT-300')

      // Build devcontainer exec command (uses prompt file, not inline prompt)
      const promptFile = '/workspace/repo/.prlt-prompt-TKT-300-123.txt'
      const containerId = 'abc123'
      const dockerCmd = buildDevcontainerCommand(
        ctx, 'claude-code', promptFile, containerId, 'interactive', 'danger', 'terminal'
      )

      expect(dockerCmd).to.include('docker exec')
      expect(dockerCmd).to.include(containerId)
      expect(dockerCmd).to.include(`$(cat ${promptFile})`)
      expect(dockerCmd).to.include('claude')
    })

    it('should produce correct codex command pipeline', () => {
      const ctx = makeContext()
      const prompt = buildPrompt(ctx)

      const { cmd, args } = getExecutorCommand('codex', prompt, true)
      expect(cmd).to.equal('codex')
      expect(args).to.include('--yolo')
      expect(args).to.include(prompt)
    })
  })

  // =========================================================================
  // Orchestrator prompt pipeline
  // =========================================================================
  describe('orchestrator prompt delivery', () => {
    it('should build separate system prompt and user message for Claude orchestrator', () => {
      const ctx = makeContext({
        isOrchestrator: true,
        hqName: 'my-workspace',
        actionPrompt: 'Review all PRs and merge ready ones.',
      })

      // System prompt for role/context
      const systemPrompt = buildOrchestratorSystemPrompt(ctx)
      expect(systemPrompt).to.include('Orchestrator')
      expect(systemPrompt).to.include('my-workspace')
      expect(systemPrompt).to.include('Command Reference')

      // Full prompt (combined for non-Claude executors)
      const fullPrompt = buildPrompt(ctx)
      expect(fullPrompt).to.include('Orchestrator')
      expect(fullPrompt).to.include('Review all PRs')

      // Verify system prompt is a subset-ish of full prompt content
      expect(fullPrompt).to.include('my-workspace')
    })

    it('should include integration commands in orchestrator prompt', () => {
      const ctx = makeContext({
        isOrchestrator: true,
        connectedIntegrations: ['linear', 'asana'],
      })

      const systemPrompt = buildOrchestratorSystemPrompt(ctx)
      expect(systemPrompt).to.include('Linear')
      expect(systemPrompt).to.include('Asana')
      expect(systemPrompt).to.include('ANTI-PATTERN')
    })
  })

  // =========================================================================
  // Prompt content validation
  // =========================================================================
  describe('prompt content completeness', () => {
    it('should include all ticket metadata in generated prompt', () => {
      const ctx = makeContext({
        ticketSubtasks: [
          { title: 'Write unit tests', done: false },
          { title: 'Update docs', done: true },
        ],
        epicTitle: 'API Resilience',
        customMessage: 'Use axios-retry library.',
        connectedIntegrations: ['linear'],
      })

      const prompt = buildPrompt(ctx)

      // All metadata present
      expect(prompt).to.include('TKT-300')
      expect(prompt).to.include('Add retry logic to API client')
      expect(prompt).to.include('exponential backoff')
      expect(prompt).to.include('P1')
      expect(prompt).to.include('feature')
      expect(prompt).to.include('API Resilience')
      expect(prompt).to.include('[ ] Write unit tests')
      expect(prompt).to.include('[x] Update docs')
      expect(prompt).to.include('axios-retry library')
      expect(prompt).to.include('Linear')

      // Completion instructions
      expect(prompt).to.include('prlt work ready TKT-300 --pr')
      expect(prompt).to.include('prlt commit')
      expect(prompt).to.include('git push')

      // Safety
      expect(prompt).to.include('**STOP:**')
    })

    it('should produce different prompts for different executor types', () => {
      const ctx = makeContext()
      const prompt = buildPrompt(ctx)

      // Claude gets full flags
      const claude = getExecutorCommand('claude-code', prompt, true)
      expect(claude.args).to.include('--dangerously-skip-permissions')

      // Codex gets --yolo instead
      const codex = getExecutorCommand('codex', prompt, true)
      expect(codex.args).to.include('--yolo')
      expect(codex.args).to.not.include('--dangerously-skip-permissions')

      // Both get the same prompt content
      expect(claude.args).to.include(prompt)
      expect(codex.args).to.include(prompt)
    })

    it('should produce a prompt for revision mode with PR feedback', () => {
      const ctx = makeContext({
        isRevision: true,
        prFeedback: '## PR Review Comments\n\n- Fix the null check on line 42\n- Add error handling for timeout',
      })

      const prompt = buildPrompt(ctx)
      expect(prompt).to.include('Revision')
      expect(prompt).to.include('Fix the null check on line 42')
      expect(prompt).to.include('error handling for timeout')
      expect(prompt).to.include('Original Ticket Context')
    })
  })

  // =========================================================================
  // Integration commands in prompt
  // =========================================================================
  describe('integration commands injection', () => {
    it('should inject integration commands into ticket prompt', () => {
      const ctx = makeContext({ connectedIntegrations: ['jira', 'shortcut'] })
      const prompt = buildPrompt(ctx)
      expect(prompt).to.include('Jira')
      expect(prompt).to.include('prlt jira')
      expect(prompt).to.include('Shortcut')
      expect(prompt).to.include('prlt shortcut')
    })

    it('should not inject integration section when none connected', () => {
      const ctx = makeContext({ connectedIntegrations: [] })
      const prompt = buildPrompt(ctx)
      expect(prompt).to.not.include('## Integration Commands')
    })

    it('should inject all five providers when all are connected', () => {
      const ctx = makeContext({
        connectedIntegrations: ['asana', 'linear', 'jira', 'shortcut', 'monday'],
      })
      const section = buildIntegrationCommandsSection(ctx.connectedIntegrations)
      expect(section).to.include('Asana')
      expect(section).to.include('Linear')
      expect(section).to.include('Jira')
      expect(section).to.include('Shortcut')
      expect(section).to.include('Monday.com')
    })
  })
})
