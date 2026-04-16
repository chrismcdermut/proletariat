/**
 * Prompt Builder
 *
 * Functions for building agent prompts including:
 * - Integration commands for connected services
 * - Orchestrator prompt (system prompt + user message)
 * - Ticket prompt (action + ticket content + completion instructions)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExecutionContext } from '../types.js'
import { resolveToolsForSpawn } from '../../tool-registry/index.js'
import { getHostPrltVersion } from './docker-management.js'

// =============================================================================
// Integration Commands
// =============================================================================

interface IntegrationCommandSet {
  provider: string
  displayName: string
  commands: string[]
}

const INTEGRATION_COMMANDS: IntegrationCommandSet[] = [
  {
    provider: 'asana',
    displayName: 'Asana',
    commands: [
      'prlt asana connect — authenticate with Asana',
      'prlt asana sync --ticket <id> --create-missing --project <gid> — sync a ticket to Asana',
      'prlt asana import — import Asana tasks into PMO',
    ],
  },
  {
    provider: 'linear',
    displayName: 'Linear',
    commands: [
      'prlt linear connect — authenticate with Linear',
      'prlt linear sync --ticket <id> --create-missing — sync a ticket to Linear',
      'prlt linear import — import Linear issues into PMO',
    ],
  },
  {
    provider: 'jira',
    displayName: 'Jira',
    commands: [
      'prlt jira connect — authenticate with Jira',
      'prlt jira sync --ticket <id> --create-missing — sync a ticket to Jira',
      'prlt jira import — import Jira issues into PMO',
    ],
  },
  {
    provider: 'shortcut',
    displayName: 'Shortcut',
    commands: [
      'prlt shortcut connect — authenticate with Shortcut',
      'prlt shortcut sync --ticket <id> --create-missing — sync a ticket to Shortcut',
      'prlt shortcut import — import Shortcut stories into PMO',
    ],
  },
  {
    provider: 'monday',
    displayName: 'Monday.com',
    commands: [
      'prlt monday connect — authenticate with Monday.com',
      'prlt monday sync --ticket <id> --create-missing — sync a ticket to Monday.com',
    ],
  },
]

export function buildIntegrationCommandsSection(connectedIntegrations?: string[]): string {
  if (!connectedIntegrations || connectedIntegrations.length === 0) return ''

  const connected = INTEGRATION_COMMANDS.filter(ic =>
    connectedIntegrations.includes(ic.provider)
  )
  if (connected.length === 0) return ''

  let section = `## Integration Commands\n\n`
  section += `The following external integrations are connected. Use these prlt commands to interact with them.\n\n`

  for (const integration of connected) {
    section += `### ${integration.displayName}\n`
    for (const cmd of integration.commands) {
      section += `- \`${cmd.split(' — ')[0]}\` — ${cmd.split(' — ')[1] || ''}\n`
    }
    section += '\n'
  }

  section += `**ANTI-PATTERN:** Never use curl, raw API calls, or shell scripts to interact with external services (Asana, Linear, Jira, Shortcut, Monday.com, etc.). Always use the corresponding \`prlt\` commands.\n\n`

  return section
}

// =============================================================================
// Orchestrator Prompt — Dynamic Command Registry
// =============================================================================

interface OrchestratorCommandDef {
  cmd: string
  desc: string
  checkPath?: string
}

interface CommandCategory {
  title: string
  commands: OrchestratorCommandDef[]
}

const ORCHESTRATOR_COMMAND_REGISTRY: CommandCategory[] = [
  {
    title: 'Agent Lifecycle',
    commands: [
      { cmd: 'prlt work start <ticket> --ephemeral --skip-permissions --create-pr --verify-ci --display background --run-on-host --yes', desc: 'Spawn an agent for a ticket', checkPath: 'work/start' },
      { cmd: 'prlt session list', desc: 'List running sessions', checkPath: 'session/list' },
      { cmd: 'prlt session inspect <agent>', desc: 'Inspect session details', checkPath: 'session/inspect' },
      { cmd: 'prlt session poke <agent> \'message\'', desc: 'Send message to agent', checkPath: 'session/poke' },
      { cmd: 'prlt session peek <agent> --lines 200', desc: 'Read agent output', checkPath: 'session/peek' },
      { cmd: 'prlt session health', desc: 'Check health of all sessions', checkPath: 'session/health' },
      { cmd: 'prlt session restart <agent>', desc: 'Restart a stuck agent', checkPath: 'session/restart' },
      { cmd: 'prlt session exec <agent> -- git status', desc: 'Run command in agent context', checkPath: 'session/exec' },
      { cmd: 'prlt session prune', desc: 'Clean up dead sessions', checkPath: 'session/prune' },
    ],
  },
  {
    title: 'Board Management',
    commands: [
      { cmd: 'prlt board view', desc: 'View the board', checkPath: 'board/view' },
      { cmd: 'prlt ticket list', desc: 'List tickets', checkPath: 'ticket/list' },
      { cmd: 'prlt ticket show <id>', desc: 'Show ticket details', checkPath: 'ticket/show' },
      { cmd: 'prlt ticket create --title \'x\' --description \'y\'', desc: 'Create a ticket', checkPath: 'ticket/create' },
      { cmd: 'prlt ticket edit <id> --title \'...\' --add-ac \'...\'', desc: 'Edit ticket fields', checkPath: 'ticket/edit' },
    ],
  },
  {
    title: 'PR Workflow',
    commands: [
      { cmd: 'prlt work ship <ticket-id>', desc: 'Merge PR and move ticket to Done', checkPath: 'work/ship' },
      { cmd: 'prlt work ship <ticket-id> --when-green', desc: 'Auto-merge when CI passes', checkPath: 'work/ship' },
      { cmd: 'prlt pr checks', desc: 'Check CI status for current PR', checkPath: 'pr/checks' },
      { cmd: 'gh pr list', desc: 'List open PRs' },
      { cmd: 'gh pr view <num>', desc: 'View PR details' },
      { cmd: 'gh pr checks <num>', desc: 'Check CI status' },
    ],
  },
]

interface AntiPatternDef {
  bad: string
  good: string
  checkPath?: string
}

const ORCHESTRATOR_ANTI_PATTERNS: AntiPatternDef[] = [
  { bad: 'gh pr merge', good: 'prlt work ship <ticket-id>', checkPath: 'work/ship' },
  { bad: 'gh pr create', good: 'prlt pr create or prlt work propose <ticket-id>', checkPath: 'pr/create' },
  { bad: 'docker exec <container> ...', good: 'prlt session exec', checkPath: 'session/exec' },
  { bad: 'tmux send-keys ...', good: 'prlt session poke', checkPath: 'session/poke' },
  { bad: 'tmux capture-pane ...', good: 'prlt session peek', checkPath: 'session/peek' },
  { bad: 'Direct git operations on agent worktrees', good: 'prlt session exec', checkPath: 'session/exec' },
]

let _commandsDir: string | null = null

function getCommandsDir(): string {
  if (_commandsDir === null) {
    const currentFile = fileURLToPath(import.meta.url)
    // From dist/lib/execution/runners/prompt-builder.js → dist/commands/
    _commandsDir = path.resolve(path.dirname(currentFile), '..', '..', '..', 'commands')
  }
  return _commandsDir
}

function isCommandAvailable(checkPath: string): boolean {
  const dir = getCommandsDir()
  return fs.existsSync(path.join(dir, `${checkPath}.js`)) || fs.existsSync(path.join(dir, checkPath))
}

function buildOrchestratorCommandReference(): string {
  let ref = ''
  for (const category of ORCHESTRATOR_COMMAND_REGISTRY) {
    const available = category.commands.filter(c => !c.checkPath || isCommandAvailable(c.checkPath))
    if (available.length === 0) continue
    ref += `### ${category.title}\n`
    for (const cmd of available) {
      ref += `- \`${cmd.cmd}\` — ${cmd.desc}\n`
    }
    ref += '\n'
  }
  return ref
}

function buildOrchestratorAntiPatterns(): string {
  const available = ORCHESTRATOR_ANTI_PATTERNS.filter(ap => !ap.checkPath || isCommandAvailable(ap.checkPath))
  if (available.length === 0) return ''
  let section = `## Anti-Patterns — NEVER DO\n\n`
  for (const ap of available) {
    section += `- \`${ap.bad}\` → use \`${ap.good}\` instead\n`
  }
  section += `\n`
  return section
}

function buildOrchestratorBody(hqName: string, context: ExecutionContext): string {
  let prompt = ''
  const prltVersion = getHostPrltVersion()
  prompt += `## Environment\n`
  if (prltVersion) {
    prompt += `- **prlt version**: ${prltVersion}\n`
  }
  prompt += `- **Available executors**: claude-code, codex\n`
  prompt += `- **Agent worktrees**: \`agents/temp/<agent-name>/<repo>\` — each agent gets an isolated git worktree\n`
  if (context.hqPath) {
    prompt += `- **HQ path**: \`${context.hqPath}\`\n`
  }
  prompt += `\n`
  prompt += `## prlt Is Your Orchestration Runtime\n\n`
  prompt += `prlt is your orchestration runtime. NEVER use raw docker exec, tmux send-keys, or direct container access. `
  prompt += `All orchestration goes through prlt. Every agent interaction, session management, and board operation `
  prompt += `has a dedicated prlt command. Using raw infrastructure commands bypasses session tracking, breaks `
  prompt += `health monitoring, and creates orphaned processes.\n\n`
  prompt += `## Your Role\n`
  prompt += `- Assess the current state of the board, running agents, and open PRs\n`
  prompt += `- Plan and prioritize work — decide what to tackle next and in what order\n`
  prompt += `- Delegate implementation to agents via \`prlt work start\`\n`
  prompt += `- Monitor agent progress via sessions and review completed work\n`
  prompt += `- Review and merge completed PRs via \`prlt work ship <ticket-id>\`\n`
  prompt += `- Coordinate parallel agents — handle rebases after merges\n`
  prompt += `- Never write code or make changes to source files yourself\n\n`
  prompt += `## Command Reference\n\n`
  prompt += buildOrchestratorCommandReference()
  prompt += `## Spawning Agents\n`
  prompt += `\`\`\`\n`
  prompt += `script -q /dev/null prlt work start <ticket-id> --ephemeral --skip-permissions --create-pr --verify-ci --display background --run-on-host --yes\n`
  prompt += `\`\`\`\n`
  prompt += `- Review: use the \`prlt work review <ticket-id>\` verb (model decides whether to comment, fix, or both)\n\n`
  prompt += buildOrchestratorAntiPatterns()
  prompt += buildIntegrationCommandsSection(context.connectedIntegrations)
  prompt += `## Workflow\n`
  prompt += `- Merge PRs: \`prlt work ship <ticket-id>\` (squash-merges and moves ticket to Done)\n`
  prompt += `- Auto-merge when CI passes: \`prlt work ship <ticket-id> --when-green\`\n`
  prompt += `- **NEVER use \`gh pr merge\`** — it skips ticket state transitions and breaks board/Linear sync\n`
  prompt += `- After merging: subsequent PRs from parallel agents will need rebase\n`
  prompt += `- Kill stale sessions after their PRs are merged\n\n`

  if (context.hqPath) {
    const toolsResult = resolveToolsForSpawn(
      context.hqPath,
      context.toolPolicy,
      path.join(context.hqPath, '.proletariat', 'scripts')
    )
    if (toolsResult.promptSection) {
      prompt += toolsResult.promptSection
    }
  }

  if (context.hqPath) {
    const contextFilePath = path.join(context.hqPath, '.orchestrator-context.md')
    if (fs.existsSync(contextFilePath)) {
      try {
        const contextContent = fs.readFileSync(contextFilePath, 'utf-8').trim()
        if (contextContent) {
          prompt += `## Workspace Context\n\n${contextContent}\n\n`
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return prompt
}

export function buildOrchestratorSystemPrompt(context: ExecutionContext): string {
  const hqName = context.hqName || 'workspace'
  let prompt = `# Orchestrator: ${hqName}\n\n`
  prompt += `You are the orchestrator for the **${hqName}** headquarters — a technical project manager driving software delivery through delegated AI agents.\n\n`
  prompt += `**prlt** is an AI agent orchestration CLI. It manages software development by coordinating autonomous coding agents that work in isolated git worktrees. `
  prompt += `Your workspace (HQ) contains a PMO board for tracking tickets, agent worktrees under \`agents/temp/\`, and repo connections. `
  prompt += `Agents are spawned to implement, review, and fix code — you never write code yourself. `
  prompt += `Your job is to assess the state of the project, plan and prioritize work, delegate to agents, monitor their progress, review results, and merge completed PRs.\n\n`
  prompt += buildOrchestratorBody(hqName, context)
  return prompt
}

function buildOrchestratorPrompt(context: ExecutionContext): string {
  const hqName = context.hqName || 'workspace'
  let prompt = `# Orchestrator: ${hqName}\n\n`
  prompt += `You are the orchestrator for the **${hqName}** headquarters — a technical project manager driving software delivery through delegated AI agents.\n\n`
  prompt += `**prlt** is an AI agent orchestration CLI. It manages software development by coordinating autonomous coding agents that work in isolated git worktrees. `
  prompt += `Your workspace (HQ) contains a PMO board for tracking tickets, agent worktrees under \`agents/temp/\`, and repo connections. `
  prompt += `Agents are spawned to implement, review, and fix code — you never write code yourself.\n\n`
  prompt += buildOrchestratorBody(hqName, context)
  if (context.actionPrompt) {
    prompt += `## Instructions\n\n${context.actionPrompt}\n`
  }
  return prompt
}

/**
 * Build workspace context section from workspace repos info (PRLT-1088).
 * Tells the agent exactly which repos are available and which is primary.
 */
function buildWorkspaceSection(context: ExecutionContext): string {
  if (!context.workspaceRepos || context.workspaceRepos.length === 0) return ''

  let section = `## Workspace\n\n`
  section += `You are working in a container with the following repos:\n`

  for (const repo of context.workspaceRepos) {
    let line = `- ${repo.path}`
    if (repo.remote) {
      line += ` (${repo.remote}`
      if (repo.branch) {
        line += `, branch: ${repo.branch}`
      }
      line += `)`
    } else if (repo.branch) {
      line += ` (branch: ${repo.branch})`
    }
    if (repo.primary) {
      line += ` — PRIMARY`
    }
    section += `${line}\n`
  }

  section += `\nWork in the primary repo. Do not look for other repos.\n\n`

  return section
}

// =============================================================================
// Ticket Operations Guidance (PRLT-1224)
// =============================================================================

/**
 * Build role prompt guidance telling agents to use prlt commands for ticket operations.
 * This is "soft enforcement" (LLM tier) — the Claude Code lifecycle hooks provide
 * "hard enforcement" (auto tier) as a safety net.
 */
export function buildTicketOperationsGuidance(): string {
  let section = `\n## Ticket Operations\n\n`
  section += `Use \`prlt\` for ALL ticket and workflow operations:\n`
  section += `- \`prlt ticket move <id> <status>\` — change ticket status\n`
  section += `- \`prlt ticket comment <id> "message"\` — log progress\n`
  section += `- \`prlt commit "message"\` — commit with ticket ID\n`
  section += `- \`prlt work propose <id>\` — create PR and move to review\n\n`
  section += `**NEVER** use \`gh\`, \`curl\`, or raw API calls to interact with Linear, Jira, Asana, or other external services. `
  section += `Always use the corresponding \`prlt\` commands.\n\n`
  return section
}

// =============================================================================
// Test Enforcement Guidance (PRLT-1225)
// =============================================================================

/**
 * Build test enforcement guidance telling agents they MUST write tests.
 * This is "soft enforcement" (LLM tier) — the Claude Code PreToolUse hook
 * provides "hard enforcement" as a safety net.
 */
export function buildTestEnforcementGuidance(): string {
  let section = `\n## Test Requirements (MANDATORY)\n\n`
  section += `**Every PR MUST include tests for changed code. No exceptions.**\n\n`
  section += `- Write **unit tests** for new functions, helpers, and modified logic\n`
  section += `- Write **integration/e2e tests** for new flows, commands, and API changes\n`
  section += `- Test files go in \`test/unit/\` and \`test/e2e/\` within the package directory\n`
  section += `- If you modify source code, you MUST add or update corresponding tests\n`
  section += `- Run \`pnpm test:unit\` to verify tests pass before committing\n\n`
  section += `A pre-commit hook will block your commit if no test files were added or modified. Write tests as you go, not at the end.\n\n`
  return section
}

// =============================================================================
// CI Verification Instructions (PRLT-1126)
// =============================================================================

const MAX_CI_RETRIES = 3

/**
 * Build CI verification instructions for agent prompts.
 * When enabled, tells the agent to poll CI after pushing, read failures,
 * fix issues, and retry — up to MAX_CI_RETRIES times.
 */
export function buildCiVerificationSection(): string {
  let section = `\n## CI Verification (REQUIRED)\n\n`
  section += `**Do NOT declare done until CI is green on your PR.** After pushing and creating/updating your PR, you MUST verify CI passes.\n\n`
  section += `### CI verification loop\n\n`
  section += `After each push:\n`
  section += `1. **Wait for CI** — run \`gh pr checks <pr-number> --watch\` to poll until all checks complete\n`
  section += `2. **If CI passes** — you are done, proceed to your final summary\n`
  section += `3. **If CI fails** — read the failure logs:\n`
  section += `   \`\`\`bash\n`
  section += `   gh run view <run-id> --log-failed\n`
  section += `   \`\`\`\n`
  section += `4. **Fix the failures** — analyze the logs, fix the code, commit and push again\n`
  section += `5. **Repeat** from step 1\n\n`
  section += `### Limits\n\n`
  section += `- Maximum ${MAX_CI_RETRIES} fix-and-retry cycles. If CI still fails after ${MAX_CI_RETRIES} attempts, stop and report the remaining failures in your summary.\n`
  section += `- If a failure is clearly unrelated to your changes (e.g. flaky infrastructure test), note it in your summary and proceed.\n`

  return section
}

export function buildPrompt(context: ExecutionContext): string {
  if (context.isOrchestrator) {
    return buildOrchestratorPrompt(context)
  }

  let prompt = ''

  if (context.isRevision && context.prFeedback) {
    prompt += `# Revision: Address PR Feedback\n\n`
    prompt += context.prFeedback
    prompt += `\n\n---\n\n`
    prompt += `## Original Ticket Context\n\n`
  }

  if (context.actionPrompt) {
    prompt += `# Action: ${context.actionName || 'Work'}\n\n`
    prompt += context.actionPrompt
    prompt += `\n\n---\n\n`
  }

  // Inject workspace context before ticket section (PRLT-1088)
  prompt += buildWorkspaceSection(context)

  prompt += `# Ticket: ${context.ticketId}\n\n`
  prompt += `**Title:** ${context.ticketTitle}\n\n`
  if (context.ticketPriority) {
    prompt += `**Priority:** ${context.ticketPriority}\n`
  }
  if (context.ticketCategory) {
    prompt += `**Category:** ${context.ticketCategory}\n`
  }
  if (context.epicTitle) {
    prompt += `**Epic:** ${context.epicTitle}\n`
  }
  if (context.ticketDescription) {
    prompt += `\n## Description\n\n${context.ticketDescription}\n`
  }

  if (context.ticketSubtasks && context.ticketSubtasks.length > 0) {
    prompt += `\n## Subtasks\n\n`
    for (const subtask of context.ticketSubtasks) {
      const checkbox = subtask.done ? '[x]' : '[ ]'
      prompt += `- ${checkbox} ${subtask.title}\n`
    }
  }

  const integrationSection = buildIntegrationCommandsSection(context.connectedIntegrations)
  if (integrationSection) {
    prompt += `\n${integrationSection}`
  }

  // PRLT-1224: Soft guidance (LLM tier) — tell agents to use prlt for ticket operations
  prompt += buildTicketOperationsGuidance()

  // PRLT-1225: Soft guidance (LLM tier) — tell agents they must write tests
  if (context.modifiesCode) {
    prompt += buildTestEnforcementGuidance()
  }

  if (context.customMessage) {
    prompt += `\n## Additional Instructions\n\n${context.customMessage}\n`
  }

  if (context.hqPath) {
    const toolsResult = resolveToolsForSpawn(
      context.hqPath,
      context.toolPolicy,
      path.join(context.hqPath, '.proletariat', 'scripts')
    )
    if (toolsResult.promptSection) {
      prompt += `\n${toolsResult.promptSection}`
    }
  }

  prompt += `\n---\n\n## When Complete\n\n`

  if (context.isRevision) {
    prompt += `After addressing the feedback:\n`
    prompt += `1. Commit your changes using \`prlt commit "your message"\`\n`
    prompt += `2. Push your changes: \`git push origin HEAD\`\n`
    prompt += `\nThe PR will be updated automatically.`
  } else if (context.actionEndPrompt) {
    let endPrompt = context.actionEndPrompt.replace(/\{\{TICKET_ID\}\}/g, context.ticketId)
    if (endPrompt.includes('--pr')) {
      if (!context.createPR) {
        endPrompt = endPrompt.replace(/--pr/g, '--no-pr')
      }
    }
    prompt += endPrompt
  } else {
    if (context.modifiesCode) {
      const reviewGate = context.reviewGate || 'required'

      const forbiddenBlock = `\n\n**NEVER use these commands — they skip ticket lifecycle updates and break board sync:**\n` +
        `- \`gh pr create\` → use \`prlt work propose ${context.ticketId}\` instead\n` +
        `- \`gh pr merge\` → use \`prlt work ship ${context.ticketId}\` instead`

      if (reviewGate === 'auto') {
        // Auto mode: agent ships directly to main, no PR needed
        prompt += `1. **Commit your work** in each repository directory you modified:\n`
        prompt += `   \`\`\`bash\n`
        prompt += `   cd /workspace/<repo-name>\n`
        prompt += `   git add -A\n`
        prompt += `   prlt commit "describe your change"\n`
        prompt += `   git push origin HEAD\n`
        prompt += `   \`\`\`\n`
        prompt += `   This formats your commit as a conventional commit with the ticket ID.\n`
        prompt += `\n2. **Mark work as ready** by running:\n`
        prompt += `   \`\`\`bash\n   prlt work ready ${context.ticketId} --no-pr\n   \`\`\`\n`
        prompt += `   This moves the ticket to done. No PR is needed — your work ships directly.\n`
        prompt += `\n**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`
        prompt += forbiddenBlock
      } else if (reviewGate === 'post') {
        // Post mode: agent creates and merges its own PR, human reviews after
        prompt += `1. **Commit your work** in each repository directory you modified:\n`
        prompt += `   \`\`\`bash\n`
        prompt += `   cd /workspace/<repo-name>\n`
        prompt += `   git add -A\n`
        prompt += `   prlt commit "describe your change"\n`
        prompt += `   git push origin HEAD\n`
        prompt += `   \`\`\`\n`
        prompt += `   This formats your commit as a conventional commit with the ticket ID.\n`
        prompt += `\n2. **Propose your work for review** by running:\n`
        prompt += `   \`\`\`bash\n   prlt work propose ${context.ticketId}\n   \`\`\`\n`
        prompt += `   This creates a pull request and moves the ticket to review. The PR will be auto-merged — a human will review post-merge.\n`
        prompt += `\n**IMPORTANT:** Use \`prlt work propose\` — do NOT use \`gh pr create\` directly, as that skips ticket state transitions.`
        prompt += `\n**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`
        prompt += forbiddenBlock
      } else {
        // Required mode (default): agent creates PR, human approves before it lands
        prompt += `1. **Commit your work** in each repository directory you modified:\n`
        prompt += `   \`\`\`bash\n`
        prompt += `   cd /workspace/<repo-name>\n`
        prompt += `   git add -A\n`
        prompt += `   prlt commit "describe your change"\n`
        prompt += `   git push origin HEAD\n`
        prompt += `   \`\`\`\n`
        prompt += `   This formats your commit as a conventional commit with the ticket ID.\n`
        if (context.createPR) {
          prompt += `\n2. **Propose your work for review** by running:\n`
          prompt += `   \`\`\`bash\n   prlt work propose ${context.ticketId}\n   \`\`\`\n`
          prompt += `   This creates a pull request and moves the ticket to Review automatically.\n`
          prompt += `\n**IMPORTANT:** Use \`prlt work propose\` — do NOT use \`gh pr create\` directly, as that skips ticket state transitions.`
        } else {
          prompt += `\n2. **Mark work as ready** by running:\n`
          prompt += `   \`\`\`bash\n   prlt work ready ${context.ticketId} --no-pr\n   \`\`\`\n`
          prompt += `   This moves the ticket to review.\n`
        }
        prompt += `\n**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`
        prompt += forbiddenBlock
      }
    } else {
      prompt += `When you have completed the task, provide a summary of what you did.`
    }
  }

  // Inject CI verification instructions when enabled (PRLT-1126)
  if (context.verifyCi && context.createPR) {
    prompt += buildCiVerificationSection()
  }

  prompt += `\n\n---\n\n**STOP:** After providing your final summary, your task is complete. Do not take any further actions, do not verify your work again, and do not continue the conversation. Simply output your summary and stop.`

  return prompt
}
