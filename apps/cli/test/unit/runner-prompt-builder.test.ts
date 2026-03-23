import { expect } from 'chai'
import {
  buildIntegrationCommandsSection,
  buildOrchestratorSystemPrompt,
  buildPrompt,
} from '../../src/lib/execution/runners/prompt-builder.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for prompt building — integration commands, orchestrator prompts, ticket prompts.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-500',
  ticketTitle: 'Implement user authentication',
  ticketDescription: 'Add OAuth2 login flow with refresh tokens.',
  agentName: 'test-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'TKT-500/feat/test',
  ...overrides,
})

describe('Prompt Builder (TKT-140)', () => {
  // =========================================================================
  // buildIntegrationCommandsSection
  // =========================================================================
  describe('buildIntegrationCommandsSection', () => {
    it('should return empty string when no integrations', () => {
      expect(buildIntegrationCommandsSection([])).to.equal('')
      expect(buildIntegrationCommandsSection(undefined)).to.equal('')
    })

    it('should return empty string for unknown providers', () => {
      expect(buildIntegrationCommandsSection(['unknown-provider'])).to.equal('')
    })

    it('should include linear commands when linear is connected', () => {
      const section = buildIntegrationCommandsSection(['linear'])
      expect(section).to.include('## Integration Commands')
      expect(section).to.include('Linear')
      expect(section).to.include('prlt linear connect')
      expect(section).to.include('prlt linear sync')
      expect(section).to.include('prlt linear import')
    })

    it('should include asana commands when asana is connected', () => {
      const section = buildIntegrationCommandsSection(['asana'])
      expect(section).to.include('Asana')
      expect(section).to.include('prlt asana connect')
    })

    it('should include jira commands when jira is connected', () => {
      const section = buildIntegrationCommandsSection(['jira'])
      expect(section).to.include('Jira')
      expect(section).to.include('prlt jira connect')
    })

    it('should include shortcut commands when shortcut is connected', () => {
      const section = buildIntegrationCommandsSection(['shortcut'])
      expect(section).to.include('Shortcut')
      expect(section).to.include('prlt shortcut connect')
    })

    it('should include monday commands when monday is connected', () => {
      const section = buildIntegrationCommandsSection(['monday'])
      expect(section).to.include('Monday.com')
      expect(section).to.include('prlt monday connect')
    })

    it('should include multiple providers when all are connected', () => {
      const section = buildIntegrationCommandsSection(['linear', 'asana', 'jira'])
      expect(section).to.include('Linear')
      expect(section).to.include('Asana')
      expect(section).to.include('Jira')
    })

    it('should include anti-pattern warning', () => {
      const section = buildIntegrationCommandsSection(['linear'])
      expect(section).to.include('ANTI-PATTERN')
      expect(section).to.include('Never use curl')
    })
  })

  // =========================================================================
  // buildPrompt — Ticket Prompt
  // =========================================================================
  describe('buildPrompt (ticket mode)', () => {
    it('should include ticket ID and title', () => {
      const prompt = buildPrompt(makeContext())
      expect(prompt).to.include('TKT-500')
      expect(prompt).to.include('Implement user authentication')
    })

    it('should include description', () => {
      const prompt = buildPrompt(makeContext())
      expect(prompt).to.include('OAuth2 login flow')
    })

    it('should include priority when set', () => {
      const prompt = buildPrompt(makeContext({ ticketPriority: 'P0' }))
      expect(prompt).to.include('P0')
    })

    it('should include category when set', () => {
      const prompt = buildPrompt(makeContext({ ticketCategory: 'feature' }))
      expect(prompt).to.include('feature')
    })

    it('should include epic title when set', () => {
      const prompt = buildPrompt(makeContext({ epicTitle: 'Auth Overhaul' }))
      expect(prompt).to.include('Auth Overhaul')
    })

    it('should include subtasks with checkboxes', () => {
      const prompt = buildPrompt(makeContext({
        ticketSubtasks: [
          { title: 'Add login endpoint', done: false },
          { title: 'Add refresh token', done: true },
        ],
      }))
      expect(prompt).to.include('[ ] Add login endpoint')
      expect(prompt).to.include('[x] Add refresh token')
    })

    it('should include integration commands when connected', () => {
      const prompt = buildPrompt(makeContext({ connectedIntegrations: ['linear'] }))
      expect(prompt).to.include('Linear')
      expect(prompt).to.include('prlt linear')
    })

    it('should include custom message as additional instructions', () => {
      const prompt = buildPrompt(makeContext({ customMessage: 'Focus on security' }))
      expect(prompt).to.include('Additional Instructions')
      expect(prompt).to.include('Focus on security')
    })

    it('should include completion instructions with prlt work ready', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true, createPR: true }))
      expect(prompt).to.include('prlt work ready TKT-500 --pr')
      expect(prompt).to.include('prlt commit')
    })

    it('should use --no-pr when createPR is false', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: true, createPR: false }))
      expect(prompt).to.include('prlt work ready TKT-500 --no-pr')
    })

    it('should include STOP instruction at the end', () => {
      const prompt = buildPrompt(makeContext())
      expect(prompt).to.include('**STOP:**')
    })

    it('should include action prompt when actionName is set', () => {
      const prompt = buildPrompt(makeContext({
        actionName: 'Implement',
        actionPrompt: '# Action: Implement\n\nWrite the code.',
      }))
      expect(prompt).to.include('# Action: Implement')
      expect(prompt).to.include('Write the code.')
    })

    it('should include revision context for PR feedback', () => {
      const prompt = buildPrompt(makeContext({
        isRevision: true,
        prFeedback: 'Please fix the typo on line 42.',
      }))
      expect(prompt).to.include('Revision')
      expect(prompt).to.include('fix the typo on line 42')
    })

    it('should use actionEndPrompt when provided', () => {
      const prompt = buildPrompt(makeContext({
        actionName: 'Implement',
        actionPrompt: 'Build the feature.',
        actionEndPrompt: 'Run `prlt work ready {{TICKET_ID}} --pr`',
        createPR: true,
      }))
      expect(prompt).to.include('prlt work ready TKT-500 --pr')
    })

    it('should replace --pr with --no-pr in actionEndPrompt when createPR=false', () => {
      const prompt = buildPrompt(makeContext({
        actionName: 'Implement',
        actionPrompt: 'Build the feature.',
        actionEndPrompt: 'Run `prlt work ready {{TICKET_ID}} --pr`',
        createPR: false,
      }))
      expect(prompt).to.include('--no-pr')
    })

    it('should show summary instruction when modifiesCode is false', () => {
      const prompt = buildPrompt(makeContext({ modifiesCode: false }))
      expect(prompt).to.include('provide a summary')
    })
  })

  // =========================================================================
  // buildPrompt — Workspace Context (PRLT-1088)
  // =========================================================================
  describe('buildPrompt (workspace context)', () => {
    it('should include workspace section when workspaceRepos is provided', () => {
      const prompt = buildPrompt(makeContext({
        workspaceRepos: [
          {
            name: 'proletariat',
            path: '/workspace/proletariat',
            remote: 'chrismcdermut/proletariat',
            branch: 'main',
            primary: true,
          },
        ],
      }))
      expect(prompt).to.include('## Workspace')
      expect(prompt).to.include('/workspace/proletariat')
      expect(prompt).to.include('chrismcdermut/proletariat')
      expect(prompt).to.include('branch: main')
      expect(prompt).to.include('PRIMARY')
      expect(prompt).to.include('Work in the primary repo')
    })

    it('should include multiple repos with primary marker', () => {
      const prompt = buildPrompt(makeContext({
        workspaceRepos: [
          {
            name: 'proletariat',
            path: '/workspace/proletariat',
            remote: 'chrismcdermut/proletariat',
            branch: 'main',
            primary: true,
          },
          {
            name: 'proletariat-marketing',
            path: '/workspace/proletariat-marketing',
            remote: 'chrismcdermut/proletariat-marketing',
            branch: 'main',
            primary: false,
          },
        ],
      }))
      expect(prompt).to.include('/workspace/proletariat')
      expect(prompt).to.include('/workspace/proletariat-marketing')
      // Only proletariat should be marked as PRIMARY
      const lines = prompt.split('\n')
      const primaryLines = lines.filter(l => l.includes('PRIMARY'))
      expect(primaryLines).to.have.length(1)
      expect(primaryLines[0]).to.include('proletariat')
    })

    it('should not include workspace section when workspaceRepos is empty', () => {
      const prompt = buildPrompt(makeContext({ workspaceRepos: [] }))
      expect(prompt).to.not.include('## Workspace')
    })

    it('should not include workspace section when workspaceRepos is undefined', () => {
      const prompt = buildPrompt(makeContext({ workspaceRepos: undefined }))
      expect(prompt).to.not.include('## Workspace')
    })

    it('should handle repos without remote or branch info', () => {
      const prompt = buildPrompt(makeContext({
        workspaceRepos: [
          {
            name: 'local-repo',
            path: '/workspace/local-repo',
            primary: true,
          },
        ],
      }))
      expect(prompt).to.include('/workspace/local-repo')
      expect(prompt).to.include('PRIMARY')
      expect(prompt).to.not.include('undefined')
    })

    it('should place workspace section before ticket section', () => {
      const prompt = buildPrompt(makeContext({
        workspaceRepos: [
          {
            name: 'proletariat',
            path: '/workspace/proletariat',
            primary: true,
          },
        ],
      }))
      const workspaceIdx = prompt.indexOf('## Workspace')
      const ticketIdx = prompt.indexOf('# Ticket:')
      expect(workspaceIdx).to.be.greaterThan(-1)
      expect(ticketIdx).to.be.greaterThan(-1)
      expect(workspaceIdx).to.be.lessThan(ticketIdx)
    })
  })

  // =========================================================================
  // buildPrompt — Orchestrator Mode
  // =========================================================================
  describe('buildPrompt (orchestrator mode)', () => {
    it('should produce orchestrator prompt when isOrchestrator=true', () => {
      const prompt = buildPrompt(makeContext({ isOrchestrator: true }))
      expect(prompt).to.include('Orchestrator')
    })

    it('should include HQ name in orchestrator prompt', () => {
      const prompt = buildPrompt(makeContext({
        isOrchestrator: true,
        hqName: 'my-workspace',
      }))
      expect(prompt).to.include('my-workspace')
    })

    it('should include command reference section', () => {
      const prompt = buildPrompt(makeContext({ isOrchestrator: true }))
      expect(prompt).to.include('Command Reference')
    })

    it('should include action instructions when provided', () => {
      const prompt = buildPrompt(makeContext({
        isOrchestrator: true,
        actionPrompt: 'Review all open PRs and merge ready ones.',
      }))
      expect(prompt).to.include('Review all open PRs')
    })
  })

  // =========================================================================
  // buildOrchestratorSystemPrompt
  // =========================================================================
  describe('buildOrchestratorSystemPrompt', () => {
    it('should include orchestrator role description', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({ isOrchestrator: true }))
      expect(systemPrompt).to.include('Orchestrator')
      expect(systemPrompt).to.include('technical project manager')
    })

    it('should include HQ name', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({
        isOrchestrator: true,
        hqName: 'test-hq',
      }))
      expect(systemPrompt).to.include('test-hq')
    })

    it('should include prlt command reference', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({ isOrchestrator: true }))
      expect(systemPrompt).to.include('prlt')
      expect(systemPrompt).to.include('Command Reference')
    })

    it('should include environment section', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({ isOrchestrator: true }))
      expect(systemPrompt).to.include('## Environment')
      expect(systemPrompt).to.include('Available executors')
    })

    it('should include orchestration runtime warning', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({ isOrchestrator: true }))
      expect(systemPrompt).to.include('prlt Is Your Orchestration Runtime')
    })

    it('should include connected integrations', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({
        isOrchestrator: true,
        connectedIntegrations: ['linear'],
      }))
      expect(systemPrompt).to.include('Linear')
    })

    it('should include workflow section', () => {
      const systemPrompt = buildOrchestratorSystemPrompt(makeContext({ isOrchestrator: true }))
      expect(systemPrompt).to.include('Workflow')
      expect(systemPrompt).to.include('squash')
    })
  })
})
