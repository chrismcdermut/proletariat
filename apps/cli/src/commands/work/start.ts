import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js'
import { StateCategory, WorkAction } from '../../lib/pmo/types.js'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
  createEphemeralAgent,
  getTicketTmuxSession,
  killTmuxSession,
  WorkspaceInfo,
} from '../../lib/agents/commands.js'
import { Agent } from '../../lib/database/index.js'
import {
  DisplayMode,
  SessionManager,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  TerminalApp,
  Shell,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution, isDockerRunning, isGitHubTokenAvailable } from '../../lib/execution/runners.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { loadExecutionConfig, getTerminalApp, promptTerminalPreference, getShell, promptShellPreference, hasTerminalPreference, hasShellPreference, getOrPromptCoderName } from '../../lib/execution/config.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import { isGHInstalled, isGHAuthenticated } from '../../lib/pr/index.js'

/**
 * Try to execute a git command, return true if successful
 */
function tryGitCommand(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a directory is a git repository
 */
function isGitRepo(dir: string): boolean {
  return tryGitCommand('git rev-parse --git-dir', dir)
}

/**
 * Find the first existing branch from a list of candidates
 */
function findBaseBranch(repoPath: string, candidates: string[] = ['origin/main', 'origin/master']): string {
  for (const branch of candidates) {
    if (tryGitCommand(`git rev-parse --verify ${branch}`, repoPath)) {
      return branch
    }
  }
  return 'HEAD'
}

/**
 * Get active staff agents that exist on disk.
 * Warns about any agents in DB that are missing their directory.
 */
function getActiveStaffAgents(
  workspaceInfo: WorkspaceInfo,
  log: (msg: string) => void
): Agent[] {
  const result: Agent[] = []

  for (const agent of workspaceInfo.agents) {
    if (agent.type !== 'persistent' || agent.status !== 'active') continue

    const agentDir = agent.worktree_path
      ? path.join(workspaceInfo.path, agent.worktree_path)
      : path.join(workspaceInfo.path, 'agents', 'staff', agent.name)

    if (fs.existsSync(agentDir)) {
      result.push(agent)
    } else {
      log(styles.warning(`⚠ Agent '${agent.name}' in database but directory missing - skipping`))
    }
  }

  return result
}

export default class WorkStart extends PMOCommand {
  static description = 'Start work on a ticket (launches an agent to implement it)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode foreground',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode tmux',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode terminal',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --all  # Spawn all backlog tickets',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Start work on all unassigned backlog tickets (batch mode)',
      default: false,
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    action: Flags.string({
      char: 'A',
      description: 'Action to perform (e.g., implement, groom, review)',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'Custom prompt (overrides action)',
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Stream output in real-time',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if work already in progress',
      default: false,
    }),
    'vm-host': Flags.string({
      description: 'VM host for vm mode',
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    reconfigure: Flags.boolean({
      description: 'Re-prompt for terminal app preference',
      default: false,
    }),
    'permission-mode': Flags.string({
      description: 'Permission mode for Claude Code (danger=skip checks, safe=require approval)',
      options: ['danger', 'safe'],
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready',
      default: false,
    }),
    'no-pr': Flags.boolean({
      description: 'Do not create PR when work is ready',
      default: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output mode',
      options: ['interactive', 'print'],
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode (foreground=current terminal, terminal=new tab, background=detached)',
      options: ['foreground', 'terminal', 'background'],
    }),
    session: Flags.string({
      char: 's',
      description: 'Session manager inside container (tmux runs agent in tmux inside container)',
      options: ['tmux', 'direct'],
      default: 'tmux',
    }),
    agent: Flags.string({
      description: 'Agent to assign (skips interactive selection)',
    }),
    ephemeral: Flags.boolean({
      description: 'Create an ephemeral agent on-demand (auto-generates name)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkStart)
    const projectId = (flags as { project?: string }).project

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work start', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.')
    }

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Handle batch mode (--all)
      if (flags.all) {
        await this.runBatchMode(workspaceInfo, db, executionStorage, flags)
        return
      }

      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId

      if (!ticketId) {
        // Get all tickets, optionally filtered by project if -P/--project flag is provided
        const allTickets = await this.storage.listTickets(projectId)

        if (allTickets.length === 0) {
          db.close()
          return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".')
        }

        const selected = await this.selectFromList({
          message: 'Select ticket to work on:',
          items: allTickets,
          getName: (t) => `[${t.priority || 'None'}] ${t.id} - ${t.title} (${t.assignee ? `assignee: ${t.assignee}` : 'unassigned'})`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work start ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work start' } : null,
        })

        if (!selected) {
          db.close()
          return
        }
        ticketId = selected
      }

      // Get ticket
      const ticket = await this.storage.getTicket(ticketId!)
      if (!ticket) {
        db.close()
        return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`)
      }

      // Check if ticket is blocked by dependencies
      const isBlocked = await this.storage.isTicketBlocked(ticketId!)
      if (isBlocked && !flags.force) {
        const blockers = await this.storage.getTicketBlockers(ticketId!)
        const incompleteBlockers = blockers.filter(b => b.status !== 'done' && b.status !== 'canceled')

        this.log('')
        this.log(styles.warning(`⚠️  ${ticketId} is blocked by:`))
        for (const blocker of incompleteBlockers) {
          this.log(styles.muted(`   - ${blocker.id}: ${blocker.title} (${blocker.status})`))
        }
        this.log('')

        const { startAnyway } = await inquirer.prompt([
          {
            type: 'list',
            name: 'startAnyway',
            message: 'Start anyway?',
            choices: [
              { name: 'No, cancel', value: false },
              { name: 'Yes, start despite blockers', value: true },
            ],
            default: false,
          },
        ])

        if (!startAnyway) {
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }
      }

      // Check for existing tmux session for this ticket
      const existingSession = getTicketTmuxSession(ticketId!)
      if (existingSession && !flags.force) {
        this.log('')
        this.log(styles.warning(`Ticket ${ticketId} has an active tmux session (${existingSession.agent})`))

        const { sessionAction } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sessionAction',
            message: 'What would you like to do?',
            choices: [
              { name: 'Attach to existing session', value: 'attach' },
              { name: 'Spawn new agent (keeps existing session)', value: 'spawn' },
              { name: 'Kill session and respawn', value: 'kill' },
              { name: 'Cancel', value: 'cancel' },
            ],
          },
        ])

        if (sessionAction === 'cancel') {
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }

        if (sessionAction === 'attach') {
          // Attach to existing session
          execSync(`tmux attach -t "${existingSession.sessionName}"`, { stdio: 'inherit' })
          db.close()
          return
        }

        if (sessionAction === 'kill') {
          killTmuxSession(existingSession.sessionName)
          this.log(styles.success(`Killed session ${existingSession.sessionName}`))
        }
        // For 'spawn', we continue with creating a new agent
      }

      // Agent selection: ephemeral flag, agent flag, ticket assignee, or prompt
      let agentName: string | undefined
      let agentWorktreePath: string | undefined
      let isEphemeralAgent = flags.ephemeral

      if (flags.ephemeral) {
        // Create ephemeral agent on-demand
        this.log(styles.muted('Creating ephemeral agent...'))
        const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
          skipDevcontainer: flags['run-on-host'],
          log: (msg) => this.log(msg),
        })
        agentName = ephemeralResult.name
        agentWorktreePath = ephemeralResult.worktreePath
        this.log(styles.success(`Created ephemeral agent: ${agentName}`))
      } else if (flags.agent) {
        // Agent specified via flag
        agentName = flags.agent
      } else {
        // Note: We no longer auto-reuse ticket.assignee to enable parallel work
        // (e.g., groom + implement, or multiple implementations on same ticket)
        // No agent specified - default to creating ephemeral agent (new behavior)
        // Or prompt for agent selection if staff agents exist

        // Get staff agents that exist on disk (warns about missing directories)
        const activeStaffAgents = getActiveStaffAgents(workspaceInfo, (msg) => this.log(msg))

        if (activeStaffAgents.length > 0) {
          // Clean up stale executions before checking availability (TKT-604)
          // This fixes agents appearing as "busy" when their sessions have terminated
          const cleanedUp = executionStorage.cleanupStaleExecutions()
          if (cleanedUp > 0) {
            this.log(styles.muted(`   Cleaned up ${cleanedUp} stale execution(s)`))
          }

          // Get list of busy agents (already running something)
          const busyAgentNames = new Set<string>()
          for (const agent of activeStaffAgents) {
            const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
            if (runningExecutions.length > 0) {
              busyAgentNames.add(agent.name)
            }
          }

          // Prompt to assign an agent
          const agentChoices: Array<{ name: string; value: string; disabled?: string } | inquirer.Separator> = []

          // Add ephemeral option first
          agentChoices.push({ name: 'Create new ephemeral agent (recommended)', value: '__ephemeral__' })
          agentChoices.push(new inquirer.Separator())

          // Only show staff agents that exist on disk
          const availableAgents = activeStaffAgents.filter(a => !busyAgentNames.has(a.name))
          const busyAgents = activeStaffAgents.filter(a => busyAgentNames.has(a.name))

          if (availableAgents.length > 0) {
            agentChoices.push(new inquirer.Separator('── Available Staff Agents ──'))
            for (const a of availableAgents) {
              agentChoices.push({ name: a.name, value: a.name })
            }
          }

          if (busyAgents.length > 0) {
            agentChoices.push(new inquirer.Separator('── Busy (already working) ──'))
            for (const a of busyAgents) {
              const runningExecs = executionStorage.getAgentRunningExecutions(a.name)
              const ticketIds = runningExecs.map(e => e.ticketId).join(', ')
              agentChoices.push({ name: `${a.name} (working on ${ticketIds})`, value: a.name, disabled: 'busy' })
            }
          }

          const { selectedAgent } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedAgent',
              message: `Select agent for ${ticketId}:`,
              choices: agentChoices,
            },
          ])

          if (selectedAgent === '__ephemeral__') {
            // Create ephemeral agent
            this.log(styles.muted('Creating ephemeral agent...'))
            const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
              skipDevcontainer: flags['run-on-host'],
              log: (msg) => this.log(msg),
            })
            agentName = ephemeralResult.name
            agentWorktreePath = ephemeralResult.worktreePath
            isEphemeralAgent = true
            this.log(styles.success(`Created ephemeral agent: ${agentName}`))
          } else {
            agentName = selectedAgent
          }
        } else {
          // No pre-registered agents - create ephemeral agent by default
          this.log(styles.muted('Creating ephemeral agent...'))
          const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
            skipDevcontainer: flags['run-on-host'],
            log: (msg) => this.log(msg),
          })
          agentName = ephemeralResult.name
          agentWorktreePath = ephemeralResult.worktreePath
          isEphemeralAgent = true
          this.log(styles.success(`Created ephemeral agent: ${agentName}`))
        }
      }

      // At this point agentName is guaranteed to be set
      const assignedAgent = agentName as string

      // Validate agent - for non-ephemeral agents, check if it exists in workspace
      let agentInfo = workspaceInfo.agents.find((a) => a.name === assignedAgent)
      if (!isEphemeralAgent && !agentInfo) {
        db.close()
        this.error(
          `Agent "${assignedAgent}" not found in workspace.\n` +
            `Use --ephemeral to create an ephemeral agent, or add a staff agent with "prlt agent add ${assignedAgent}"`
        )
      }

      // Check for running execution on this ticket (warning only, allows parallel work)
      const runningExecution = executionStorage.getRunningExecution(ticketId!)
      if (runningExecution) {
        this.log(styles.warning(`⚠️  Ticket "${ticketId}" already has work in progress: ${runningExecution.id}`))
        this.log(styles.muted(`   Starting parallel execution. Note: status updates may conflict.`))
      }

      // Check if agent is already working on something else
      // Skip for ephemeral agents - they're created fresh for each spawn
      if (!isEphemeralAgent) {
        const agentRunningExecutions = executionStorage.getAgentRunningExecutions(assignedAgent)
        if (agentRunningExecutions.length > 0 && !flags.force) {
          const execInfo = agentRunningExecutions.map(e => `  ${e.id}: ${e.ticketId}`).join('\n')
          db.close()
          this.error(
            `Agent "${assignedAgent}" is already working on other tickets:\n${execInfo}\n\n` +
              `Use --force to start anyway, or stop existing work first.`
          )
        }
      }

      // Determine worktree path
      // Agent directory structure varies:
      // - Ephemeral: agents/temp/{agent}/ (created on-demand)
      // - Staff HQ: agents/staff/{agent}/{repoName}/ (git worktree per repo)
      // - Workspace-only: {agentsPath}/{agent}/{repoName}/ (git worktree)
      // - HQ without repos: {agentsPath}/{agent}/ (placeholder, use cwd)

      // For ephemeral agents, use the worktree path from creation
      // For existing agents, derive from agentsPath
      let agentDir: string
      if (isEphemeralAgent && agentWorktreePath) {
        agentDir = agentWorktreePath
      } else if (agentInfo?.worktree_path) {
        // Agent has a worktree_path in the database
        agentDir = path.join(workspaceInfo.path, agentInfo.worktree_path)
      } else {
        // Fall back to default path calculation
        agentDir = path.join(workspaceInfo.agentsPath, assignedAgent)
      }

      if (!fs.existsSync(agentDir)) {
        db.close()
        this.error(
          `Agent directory not found at ${agentDir}.\n` +
            `Use --ephemeral to create an ephemeral agent, or create a staff agent with "prlt agent add ${assignedAgent}"`
        )
      }

      // For staff agents, check for uncommitted/unpushed work before starting
      if (!isEphemeralAgent) {
        const { getAgentGitStatus, pushAgentWork } = await import('../../lib/agents/commands.js')
        const gitStatus = getAgentGitStatus(workspaceInfo, assignedAgent)

        if (gitStatus.hasUnsavedWork) {
          this.log(styles.warning(`\n⚠️  Agent "${assignedAgent}" has unsaved work:`))
          for (const wt of gitStatus.worktrees) {
            if (wt.hasUncommittedChanges) {
              this.log(styles.muted(`  ${wt.repoName}: ${wt.uncommittedFiles.length} uncommitted file(s)`))
            }
            if (wt.hasUnpushedCommits) {
              this.log(styles.muted(`  ${wt.repoName}: ${wt.unpushedCount} unpushed commit(s) on ${wt.branch}`))
            }
          }
          this.log('')

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'How would you like to proceed?',
              choices: [
                { name: 'Push existing work and continue', value: 'push' },
                { name: 'Continue anyway (existing work may conflict)', value: 'continue' },
                { name: 'Cancel', value: 'cancel' },
              ],
            },
          ])

          if (action === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          if (action === 'push') {
            const pushed = pushAgentWork(workspaceInfo, assignedAgent, (msg) => this.log(styles.muted(`  ${msg}`)))
            if (!pushed) {
              this.log(styles.warning('Some work could not be pushed. Please resolve manually.'))
            }
          }
        }
      }

      // Find worktree path for agent
      // Agent directory may contain multiple repo worktrees - use the agent dir itself
      // so Claude can work across all repos (frontend, backend, etc.)
      let worktreePath = agentDir

      // Check if agent has repository worktrees (subdirectories with .git)
      const agentContents = fs.readdirSync(agentDir)
      const repoWorktrees = agentContents.filter(item => {
        const itemPath = path.join(agentDir, item)
        const gitPath = path.join(itemPath, '.git')
        return fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)
      })

      if (repoWorktrees.length === 1) {
        // Single repo - open directly in the repo worktree
        worktreePath = path.join(agentDir, repoWorktrees[0])
      } else if (repoWorktrees.length > 1) {
        // Multiple repos - open in agent directory, Claude can navigate between them
        worktreePath = agentDir
        this.log(styles.muted(`   Repos: ${repoWorktrees.join(', ')}`))
      } else {
        // No git worktrees found - agent is a placeholder
        // Fall back to the current working directory
        this.log(styles.muted(`   No git worktree found for agent, using current directory`))
        worktreePath = process.cwd()
      }

      // Get coder name for branch naming (prompts on first use)
      const coderName = await getOrPromptCoderName(db)

      // Use ticket's existing branch or generate a new one
      const branch = ticket.branch || generateBranchName(
        ticket.id,
        ticket.title,
        coderName,
        assignedAgent,
        ticket.category
      )
      const isExistingBranch = !!ticket.branch

      // Get epic info if linked
      let epicTitle: string | undefined
      if (ticket.epicId) {
        const epic = await this.storage.getEpic(ticket.epicId)
        epicTitle = epic?.title
      }

      // Get spec info if linked
      let specId: string | undefined
      let specTitle: string | undefined
      let specProblem: string | undefined
      let specSolution: string | undefined
      if (ticket.specId) {
        const spec = await this.storage.getSpec(ticket.specId)
        if (spec) {
          specId = spec.id
          specTitle = spec.title
          specProblem = spec.problem
          specSolution = spec.solution
        }
      }

      // Determine action for this work session
      let selectedAction: WorkAction | null = null
      let customPrompt: string | undefined

      if (flags.prompt) {
        // Custom prompt overrides everything
        customPrompt = flags.prompt
      } else if (flags.action) {
        // Specific action requested
        selectedAction = await this.storage.getAction(flags.action)
        if (!selectedAction) {
          db.close()
          this.error(`Action not found: ${flags.action}. Use "prlt action list" to see available actions.`)
        }
      } else {
        // Interactive action selection
        // Get ticket's current status to determine suggested action
        const ticketStatus = await this.storage.getStatus(ticket.statusId || '')
        const currentCategory: StateCategory = ticketStatus?.category || 'unstarted'

        // Get suggested action for this category
        const suggestedAction = await this.storage.getSuggestedAction(currentCategory)

        // Get all actions for selection
        const allActions = await this.storage.listActions()

        // Build choices with suggested action at top
        const actionChoices: Array<{ name: string; value: string } | inquirer.Separator> = []

        if (suggestedAction) {
          actionChoices.push({
            name: `${suggestedAction.name} - ${suggestedAction.description || 'Suggested for ' + currentCategory} (Recommended)`,
            value: suggestedAction.id,
          })
          actionChoices.push(new inquirer.Separator('── Other Actions ──'))
        }

        for (const action of allActions) {
          if (suggestedAction && action.id === suggestedAction.id) continue
          actionChoices.push({
            name: `${action.name}${action.description ? ' - ' + action.description : ''}`,
            value: action.id,
          })
        }

        actionChoices.push(new inquirer.Separator('── Custom ──'))
        actionChoices.push({ name: 'Custom prompt...', value: '__custom__' })
        actionChoices.push({ name: 'Ad-hoc session - unstructured exploration/debugging', value: '__adhoc__' })

        const { selectedActionId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedActionId',
            message: `What should the agent do with ${ticket.id}?`,
            choices: actionChoices,
          },
        ])

        if (selectedActionId === '__custom__') {
          const { customInput } = await inquirer.prompt([
            {
              type: 'input',
              name: 'customInput',
              message: 'Enter custom prompt:',
              validate: (input: string) => input.trim() ? true : 'Prompt cannot be empty',
            },
          ])
          customPrompt = customInput.trim()
        } else if (selectedActionId === '__adhoc__') {
          // Ad-hoc session - no specific action, just launch Claude for exploration
          selectedAction = {
            id: 'adhoc',
            name: 'Ad-hoc',
            description: 'Unstructured exploration and debugging',
            prompt: 'You are working on an ad-hoc session for exploration and debugging. Help the user with whatever they need.',
            modifiesCode: false,
            defaultMoveToCategory: 'started',
            isBuiltin: false,
            createdAt: new Date(),
          }
        } else {
          selectedAction = await this.storage.getAction(selectedActionId)
        }
      }

      // Build execution context with full ticket details
      // HQ path comes from workspaceInfo (not derived from pmoPath since pmo can be nested in repos)
      const hqPath = workspaceInfo.path

      const context: ExecutionContext = {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
        ticketPriority: ticket.priority,
        ticketCategory: ticket.category,
        epicTitle,
        specId,
        specTitle,
        specProblem,
        specSolution,
        agentName: assignedAgent,
        agentDir,         // Agent directory (contains .devcontainer)
        worktreePath,     // Worktree path (may be subdirectory of agentDir)
        branch,
        hqPath,
        pmoPath: this.pmoPath,          // PMO path for container mounting
        // Action context
        actionId: selectedAction?.id,
        actionName: selectedAction?.name || (customPrompt ? 'Custom' : undefined),
        actionPrompt: customPrompt || selectedAction?.prompt,
        actionEndPrompt: customPrompt ? undefined : selectedAction?.endPrompt,
        modifiesCode: customPrompt ? true : selectedAction?.modifiesCode ?? true,
      }

      // Check if agent has devcontainer config
      const hasDevcontainer = hasDevcontainerConfig(agentDir)

      // Use devcontainer by default if available, unless --run-on-host is set
      const useDevcontainer = hasDevcontainer && !flags['run-on-host']

      // Determine execution environment and display mode
      let environment: ExecutionEnvironment = 'host'
      let displayMode: DisplayMode = 'terminal'
      let sandboxed = false  // Whether --dangerously-skip-permissions is NOT used

      if (hasDevcontainer && !flags.display && !flags['run-on-host']) {
        // Agent has devcontainer - prompt for environment choice
        // Loop to allow re-selection if Docker isn't running
        let environmentSelected = false
        while (!environmentSelected) {
          const { selectedEnvironment } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedEnvironment',
              message: 'Where should the agent run?',
              choices: [
                { name: '🐳 devcontainer (sandboxed, recommended)', value: 'devcontainer' },
                { name: '💻 host (runs directly on your machine)', value: 'host' },
                { name: '✗  cancel', value: 'cancel' },
              ],
              default: 'devcontainer',
            },
          ])

          if (selectedEnvironment === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          if (selectedEnvironment === 'devcontainer') {
            // Check Docker is running before proceeding with devcontainer
            if (!isDockerRunning()) {
              this.log('')
              this.warn(
                'Docker is not running.\n' +
                'Docker is required for devcontainer execution.\n' +
                'Please start Docker Desktop or select "host" to run directly on your machine.'
              )
              this.log('')
              continue  // Re-prompt for environment selection
            }

            // Check GitHub token is available for git push operations
            if (!isGitHubTokenAvailable()) {
              const tokenChoices = [
                { name: 'Yes, continue anyway (git push may fail)', value: 'continue' },
                { name: 'No, let me run gh auth login first', value: 'cancel' },
                { name: 'Switch to host mode instead', value: 'host' },
              ]
              const tokenMessage = 'GitHub token not found. Git push may fail. Continue without token?'

              if (jsonMode) {
                outputPromptAsJson(
                  buildPromptConfig('list', 'tokenAction', tokenMessage, tokenChoices),
                  createMetadata('work start', flags)
                )
                db.close()
                return
              }

              this.log('')
              this.warn(
                'GitHub token not found.\n' +
                'Git push operations may fail inside the container.\n' +
                'Run `gh auth login` to authenticate, or continue without token.'
              )
              this.log('')

              const { tokenAction } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'tokenAction',
                  message: tokenMessage,
                  choices: tokenChoices,
                  default: 'continue',
                },
              ])

              if (tokenAction === 'cancel') {
                db.close()
                this.log(styles.muted('Run `gh auth login` and try again.'))
                return
              }

              if (tokenAction === 'host') {
                environment = 'host'
                // Skip to host mode prompts
                const { selectedDisplay } = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'selectedDisplay',
                    message: 'How should the agent output be displayed?',
                    choices: [
                      { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
                      { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground' },
                      { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
                    ],
                    default: 'terminal',
                  },
                ])
                displayMode = selectedDisplay as DisplayMode
                environmentSelected = true
                continue
              }
              // tokenAction === 'continue' - fall through to devcontainer setup
            }

            environment = 'devcontainer'
            // Pick display mode for devcontainer
            const { selectedDisplay } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedDisplay',
                message: 'How should the agent output be displayed?',
                choices: [
                  { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
                  { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground' },
                  { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
                ],
                default: 'terminal',
              },
            ])
            displayMode = selectedDisplay as DisplayMode
            environment = 'devcontainer'
            environmentSelected = true
          } else {
            // User chose host
            environment = 'host'
            const { selectedDisplay } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedDisplay',
                message: 'How should the agent output be displayed?',
                choices: [
                  { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
                  { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground' },
                  { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
                ],
                default: 'terminal',
              },
            ])
            displayMode = selectedDisplay as DisplayMode
            environmentSelected = true
          }
        }
      } else if (useDevcontainer) {
        // Devcontainer with explicit display flag
        environment = 'devcontainer'
        if (flags.display) {
          displayMode = flags.display as DisplayMode
        } else {
          // Default to terminal for devcontainer (opens new tab instead of blocking current terminal)
          displayMode = 'terminal'
        }
      } else {
        // No devcontainer or --run-on-host - host mode selection
        environment = 'host'
        if (flags.display) {
          displayMode = flags.display as DisplayMode
        } else {
          const warningMsg = flags['run-on-host']
            ? 'Select display mode (--run-on-host: bypassing devcontainer):'
            : 'Select display mode (no devcontainer - running on host):'

          const { selectedMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedMode',
              message: warningMsg,
              choices: [
                { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
                { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground' },
                { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
              ],
              default: 'terminal',
            },
          ])
          displayMode = selectedMode as DisplayMode
        }
      }

      const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

      // Default to interactive output mode (streaming UI)
      // Can be overridden via --output flag if needed
      let outputMode: OutputMode = flags.output as OutputMode || DEFAULT_EXECUTION_CONFIG.outputMode

      // Prompt for permissions mode (all environments)
      // Skip prompt if --permission-mode flag is set
      if (flags['permission-mode']) {
        sandboxed = flags['permission-mode'] === 'safe'
      } else {
        const containerNote = environment === 'devcontainer'
          ? ' (container provides additional isolation)'
          : ''
        const { permissionMode } = await inquirer.prompt([
          {
            type: 'list',
            name: 'permissionMode',
            message: `Permission mode for Claude Code${containerNote}:`,
            choices: [
              { name: '⚠️  danger - Skip permission checks (faster, container provides isolation)', value: 'danger' },
              { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
            ],
            default: 'danger',
          },
        ])
        sandboxed = permissionMode === 'safe'
      }

      // Prompt for PR creation when work is complete
      // Only show if gh CLI is available and authenticated
      let createPR = false
      const ghAvailable = isGHInstalled() && isGHAuthenticated()
      // Use flags if provided, otherwise prompt
      if (flags['create-pr']) {
        createPR = true
      } else if (flags['no-pr']) {
        createPR = false
      } else if (ghAvailable) {
        const { prChoice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'prChoice',
            message: 'Create a pull request when work is ready?',
            choices: [
              { name: '✓ Yes - Create PR when running `prlt work ready`', value: 'yes' },
              { name: '✗ No  - Just move ticket to review (can create PR later)', value: 'no' },
            ],
            default: 'yes',
          },
        ])
        createPR = prChoice === 'yes'
      }

      // Show execution info
      this.log('')
      this.log(styles.header(`🚀 Starting work: ${ticket.id}: ${ticket.title}`))
      this.log(styles.muted(`   Agent: ${assignedAgent}`))
      this.log(styles.muted(`   Action: ${context.actionName || 'None'}`))
      this.log(styles.muted(`   Executor: ${executor}`))

      // Environment info
      const envIcon = environment === 'devcontainer' ? '🐳' : '💻'
      this.log(styles.muted(`   Environment: ${envIcon} ${environment}`))
      this.log(styles.muted(`   Display: ${displayMode}`))

      // Permissions info
      if (sandboxed) {
        this.log(styles.success(`   Permissions: 🔒 safe`))
      } else {
        this.log(styles.warning(`   Permissions: ⚠️  danger (--dangerously-skip-permissions)`))
      }

      this.log(styles.muted(`   Output: ${outputMode === 'interactive' ? 'streaming (watch Claude work)' : 'print (final result only)'}`))
      if (ghAvailable) {
        this.log(styles.muted(`   Create PR: ${createPR ? 'yes (when work is ready)' : 'no'}`))
      }
      this.log(styles.muted(`   Worktree: ${worktreePath}`))
      this.log(styles.muted(`   Branch: ${branch}`))
      this.log('')

      // Add createPR to context
      context.createPR = createPR

      // Handle git operations
      let finalBranch = branch

      // Set up repo paths (needed for all action types)
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]
      const primaryRepo = gitRepos[0]

      // Always fetch latest from origin (regardless of action type)
      // This ensures groom and other non-code-modifying actions see current code
      for (const repoPath of gitRepos) {
        if (isGitRepo(repoPath)) {
          tryGitCommand('git fetch origin', repoPath)
        }
      }

      // Branch handling - only if action modifies code
      if (context.modifiesCode !== false) {
        if (isExistingBranch) {
          // Ticket already has a branch linked - just use it
          this.log(styles.muted(`Using existing branch: ${branch}`))
        } else if (flags.action || flags.force) {
          // Non-interactive mode (spawned from batch command) - auto-create branch
          finalBranch = branch
          this.log(styles.muted(`Branch: ${finalBranch}`))
        } else {
          // No branch in DB - ask user if one already exists
          const { branchChoice } = await inquirer.prompt([
            {
              type: 'list',
              name: 'branchChoice',
              message: `Does a branch already exist for ${ticket.id}?`,
              choices: [
                { name: 'No, create new branch (Recommended)', value: 'create' },
                { name: 'Yes, I\'ll enter the branch name', value: 'enter' },
                { name: 'Search for matching branches', value: 'search' },
              ],
            },
          ])

          if (branchChoice === 'enter') {
            // User enters existing branch name
            const { enteredBranch } = await inquirer.prompt([
              {
                type: 'input',
                name: 'enteredBranch',
                message: 'Enter branch name:',
                validate: (input: string) => input.trim() ? true : 'Branch name required',
              },
            ])
            finalBranch = enteredBranch.trim()

            // Validate branch exists (locally or in origin)
            try {
              execSync(`git rev-parse --verify ${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
              this.log(styles.muted(`   Found local branch: ${finalBranch}`))
            } catch {
              // Try fetching from origin
              try {
                execSync(`git fetch origin ${finalBranch}:${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
                this.log(styles.muted(`   Fetched from origin: ${finalBranch}`))
              } catch {
                this.warn(`Branch "${finalBranch}" not found locally or in origin. Will create it.`)
              }
            }
          } else if (branchChoice === 'search') {
            // Search for matching branches
            let remoteBranches: string[] = []
            try {
              execSync('git fetch --prune', { cwd: primaryRepo, stdio: 'pipe' })
              const branchOutput = execSync(`git branch -r`, { cwd: primaryRepo, encoding: 'utf-8' })
              remoteBranches = branchOutput
                .split('\n')
                .map(b => b.trim())
                .filter(b => b && !b.includes('HEAD') && b.toLowerCase().includes(ticket.id.toLowerCase()))
            } catch {
              // Ignore fetch errors
            }

            if (remoteBranches.length > 0) {
              const branchChoices = [
                ...remoteBranches.map(b => ({ name: b, value: b.replace('origin/', '') })),
                new inquirer.Separator(),
                { name: 'None of these, create new branch', value: '__create__' },
              ]

              const { selectedBranch } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'selectedBranch',
                  message: `Found ${remoteBranches.length} matching branch(es):`,
                  choices: branchChoices,
                },
              ])

              if (selectedBranch !== '__create__') {
                finalBranch = selectedBranch
                // Fetch and checkout the selected branch
                try {
                  execSync(`git fetch origin ${finalBranch}:${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
                  this.log(styles.muted(`   Fetched: ${finalBranch}`))
                } catch {
                  // Branch might already exist locally
                }
              }
            } else {
              this.log(styles.muted(`   No matching branches found for "${ticket.id}". Creating new.`))
            }
          }
          // branchChoice === 'create' uses the generated branch name (default)

          this.log(styles.muted(`Branch: ${finalBranch}`))
        }

        // Handle branch in each repo
        for (const repoPath of gitRepos) {
          const repoName = path.basename(repoPath)

          if (!isGitRepo(repoPath)) {
            continue
          }

          // Note: fetch already happened above (unconditionally for all action types)

          try {
            // Check if branch exists and checkout
            if (tryGitCommand(`git rev-parse --verify ${finalBranch}`, repoPath)) {
              execSync(`git checkout ${finalBranch}`, { cwd: repoPath, stdio: 'pipe' })
              this.log(styles.muted(`   ${repoName}: checked out branch`))
            } else {
              // Branch doesn't exist - create from best available base
              const baseBranch = findBaseBranch(repoPath)
              execSync(`git checkout -b ${finalBranch} ${baseBranch}`, { cwd: repoPath, stdio: 'pipe' })
              this.log(styles.muted(`   ${repoName}: created new branch from ${baseBranch}`))
            }
          } catch (error) {
            this.warn(`Could not handle branch in ${repoName}: ${error instanceof Error ? error.message : error}`)
          }
        }

        // Save branch to ticket
        if (!isExistingBranch || finalBranch !== branch) {
          await this.storage.updateTicket(ticket.id, { branch: finalBranch })
        }

        // Update context with final branch
        context.branch = finalBranch
      } else {
        // Non-code-modifying action (e.g., groom) - checkout main/latest to see current code
        this.log(styles.muted('Skipping branch creation (action does not modify code)'))

        for (const repoPath of gitRepos) {
          const repoName = path.basename(repoPath)

          if (!isGitRepo(repoPath)) {
            continue
          }

          try {
            // Checkout the latest main/master branch
            const baseBranch = findBaseBranch(repoPath)
            // Extract local branch name from origin/main -> main
            const localBranch = baseBranch.replace('origin/', '')
            execSync(`git checkout ${localBranch}`, { cwd: repoPath, stdio: 'pipe' })
            // Pull latest changes
            tryGitCommand(`git pull origin ${localBranch}`, repoPath)
            this.log(styles.muted(`   ${repoName}: checked out ${localBranch} (latest)`))
          } catch (error) {
            this.warn(`Could not checkout main in ${repoName}: ${error instanceof Error ? error.message : error}`)
          }
        }
      }

      // Create execution record
      const execution = executionStorage.createExecution({
        ticketId: ticket.id,
        agentName: assignedAgent,
        executor,
        environment,
        displayMode,
        sandboxed,
        branch,
      })

      this.log(styles.muted(`   Work ID: ${execution.id}`))
      this.log('')

      // Note: Ticket status update moved to after successful spawn (see below)

      // Load execution config from database
      const executionConfig = loadExecutionConfig(db)

      // If terminal display mode, ensure terminal and shell preferences are set (prompts on first use)
      // Also re-prompt if --reconfigure flag is set
      const needsTerminalConfig = displayMode === 'terminal'
      if (needsTerminalConfig) {
        const needsTerminal = !hasTerminalPreference(db)
        const needsShell = !hasShellPreference(db)

        // First-time setup: prompt for both together
        if ((needsTerminal || needsShell) && !flags.reconfigure) {
          this.log(styles.header('First-time execution setup'))
          this.log('')
        }

        let terminalApp: TerminalApp
        let shell: Shell

        if (flags.reconfigure) {
          terminalApp = await promptTerminalPreference(db)
          shell = await promptShellPreference(db)
          this.log(styles.success(`   Terminal: ${terminalApp}`))
          this.log(styles.success(`   Shell: ${shell}`))
        } else {
          terminalApp = await getTerminalApp(db)
          shell = await getShell(db)
          this.log(styles.muted(`   Terminal: ${terminalApp}`))
          this.log(styles.muted(`   Shell: ${shell}`))
        }

        executionConfig.terminal.app = terminalApp
        executionConfig.shell = shell
      }

      // Set output mode from user selection
      executionConfig.outputMode = outputMode

      // Set sandboxed mode (determines whether --dangerously-skip-permissions is used)
      executionConfig.sandboxed = sandboxed

      // Run execution
      this.log(styles.muted('Starting agent...'))
      const sessionManager = (flags.session || 'tmux') as SessionManager
      const result = await runExecution(environment, context, executor, executionConfig, {
        host: flags['vm-host'],
        displayMode,
        sessionManager: environment === 'devcontainer' ? sessionManager : undefined,
      })

      if (result.success) {
        // Update execution record with process info
        executionStorage.updateStatus(execution.id, 'running')
        executionStorage.updateProcessInfo(execution.id, {
          pid: result.pid,
          containerId: result.containerId,
          sessionId: result.sessionId,
          logPath: result.logPath,
        })

        // Track container in containers table (for devcontainer environment)
        if (environment === 'devcontainer' && result.containerId) {
          const containerStorage = new ContainerStorage(db)
          containerStorage.upsertContainer({
            agentName: context.agentName,
            dockerId: result.containerId,
            status: 'running',
            currentExecutionId: execution.id,
          })
        }

        // Update ticket assignee ONLY after successful spawn
        if (!ticket.assignee || ticket.assignee !== assignedAgent) {
          await this.storage.updateTicket(ticket.id, { assignee: assignedAgent })
          this.log(styles.muted(`   Assigned to: ${assignedAgent}`))
        }

        // Move ticket to target column based on action's defaultMoveToCategory
        // If action has a target category, find the matching column; otherwise use "started" default
        const targetCategory = selectedAction?.defaultMoveToCategory || 'started'

        const board = await this.storage.getBoard(ticket.projectId!)
        const columnNames = board.columns.map(col => col.name)

        // Map category to column type for lookup
        const columnType = targetCategory === 'started' ? 'in_progress' :
                          targetCategory === 'unstarted' ? 'planned' :
                          targetCategory === 'completed' ? 'done' : 'in_progress'

        // Get the configured column name for this type (e.g., "In Progress" for in_progress)
        const workColumnName = getWorkColumnSetting(db, columnType)

        // Find the actual column on the board (case-insensitive, partial match)
        const targetColumnName = findColumnByName(columnNames, workColumnName)

        if (targetColumnName && ticket.statusName !== targetColumnName) {
          try {
            await this.storage.moveTicket(ticket.projectId!, ticket.id, targetColumnName)
            this.log(styles.muted(`   Moved to: ${targetColumnName}`))
          } catch (moveError) {
            // Non-fatal - work can proceed even if column move fails
            this.warn(`Could not move ticket to "${targetColumnName}": ${moveError instanceof Error ? moveError.message : moveError}`)
          }
        }

        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

        this.log('')
        this.log(styles.success(`✓ Work started (${execution.id})`))
        this.log('')
        this.log(styles.muted('Commands:'))
        this.log(styles.muted(`  prlt work status              View work status`))
        this.log(styles.muted(`  prlt work ready ${ticketId}     Mark ready for review`))
        this.log(styles.muted(`  prlt work stop ${execution.id}    Stop work`))
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start work: ${result.error}`)
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Run batch mode: spawn work for all unassigned backlog tickets
   */
  private async runBatchMode(
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    db: Database.Database,
    executionStorage: ExecutionStorage,
    flags: { display?: string; executor?: string; 'vm-host'?: string; 'run-on-host': boolean; force: boolean; 'permission-mode'?: string }
  ): Promise<void> {
    // Get all tickets and filter to backlog/unstarted (not in progress)
    // Note: In batch mode, we use undefined to get all tickets across all projects
    const allTickets = await this.storage.listTickets(undefined)
    const backlogTickets = allTickets.filter(t =>
      t.statusCategory === 'backlog' || t.statusCategory === 'unstarted' || !t.statusCategory
    )

    if (backlogTickets.length === 0) {
      db.close()
      this.log(styles.muted('No backlog tickets to start.'))
      return
    }

    this.log('')
    this.log(styles.header(`🚀 Batch Start: ${backlogTickets.length} backlog tickets`))
    this.log('')

    // Get staff agents that exist on disk (warns about missing directories)
    const activeStaffAgents = getActiveStaffAgents(workspaceInfo, (msg) => this.log(msg))

    // Clean up stale executions before checking availability (TKT-604)
    const cleanedUp = executionStorage.cleanupStaleExecutions()
    if (cleanedUp > 0) {
      this.log(styles.muted(`   Cleaned up ${cleanedUp} stale execution(s)`))
    }

    const busyAgentNames = new Set<string>()
    for (const agent of activeStaffAgents) {
      const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
      if (runningExecutions.length > 0) {
        busyAgentNames.add(agent.name)
      }
    }

    const availableAgents = activeStaffAgents.filter(a => !busyAgentNames.has(a.name))

    if (availableAgents.length === 0) {
      db.close()
      this.error('No available agents. All agents are busy with other work.')
    }

    this.log(styles.muted(`Available agents: ${availableAgents.map(a => a.name).join(', ')}`))
    this.log(styles.muted(`Tickets to spawn: ${backlogTickets.map(t => t.id).join(', ')}`))
    this.log('')

    // Confirm before batch spawning
    const { confirm } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirm',
        message: `Start work on ${backlogTickets.length} tickets using ${availableAgents.length} available agents?`,
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      },
    ])

    if (!confirm) {
      db.close()
      this.log(styles.muted('Cancelled.'))
      return
    }

    // Prompt for permissions mode once for all tickets (TKT-513)
    let batchPermissionMode: 'danger' | 'safe' = flags['permission-mode'] as 'danger' | 'safe'
    if (!batchPermissionMode) {
      const { permissionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'permissionMode',
          message: 'Permission mode for Claude Code:',
          choices: [
            { name: '⚠️  danger - Skip permission checks (faster, container provides isolation)', value: 'danger' },
            { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
          ],
          default: 'danger',
        },
      ])
      batchPermissionMode = permissionMode
    }

    // Assign tickets to agents (round-robin)
    const assignments: Array<{ ticket: typeof backlogTickets[0]; agent: typeof availableAgents[0] }> = []
    for (let i = 0; i < backlogTickets.length; i++) {
      const agent = availableAgents[i % availableAgents.length]
      assignments.push({ ticket: backlogTickets[i], agent })
    }

    // Spawn each ticket
    let successCount = 0
    let failCount = 0

    for (const { ticket, agent } of assignments) {
      try {
        this.log(styles.muted(`Starting ${ticket.id} with ${agent.name}...`))

        // Use the work:start command for each ticket
        // Pass --project from ticket to avoid re-prompting for project selection
        // Pass --permission-mode to skip prompts in recursive calls (TKT-513)
        await this.config.runCommand('work:start', [
          ticket.id,
          ...(ticket.projectId ? ['--project', ticket.projectId] : []),
          '--display', flags.display || 'background',
          ...(flags.executor ? ['--executor', flags.executor] : []),
          ...(flags['run-on-host'] ? ['--run-on-host'] : []),
          ...(flags.force ? ['--force'] : []),
          '--permission-mode', batchPermissionMode,
        ])

        successCount++
      } catch (error) {
        failCount++
        this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
      }
    }

    db.close()

    this.log('')
    this.log(styles.success(`✓ Batch complete: ${successCount} started, ${failCount} failed`))

    const remaining = backlogTickets.length - assignments.length
    if (remaining > 0) {
      this.log(styles.muted(`   ${remaining} ticket(s) remain in backlog (no available agents)`))
    }
  }

  /**
   * Spawn work on a single ticket with non-interactive defaults.
   */
  private async spawnSingleTicket(
    ticket: { id: string; title: string; description?: string; assignee?: string; status?: string; priority?: string; category?: string; branch?: string; epicId?: string; specId?: string; projectId?: string; subtasks?: Array<{ title: string; done: boolean }> },
    agent: { name: string },
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    executionStorage: ExecutionStorage,
    db: Database.Database,
    flags: {
      force?: boolean
      'run-on-host'?: boolean
      'permission-mode'?: string
      'create-pr'?: boolean
      'no-pr'?: boolean
      executor?: string
      session?: string
    }
  ): Promise<void> {
    const agentName = agent.name

    // Note: Ticket assignee update moved to after successful spawn

    // Find agent directory and worktree
    const agentDir = path.join(workspaceInfo.agentsPath, agentName)
    if (!fs.existsSync(agentDir)) {
      throw new Error(`Agent directory not found: ${agentDir}`)
    }

    // Find worktree path
    let worktreePath = agentDir
    const agentContents = fs.readdirSync(agentDir)
    const repoWorktrees = agentContents.filter(item => {
      const itemPath = path.join(agentDir, item)
      const gitPath = path.join(itemPath, '.git')
      return fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)
    })

    if (repoWorktrees.length === 1) {
      worktreePath = path.join(agentDir, repoWorktrees[0])
    }

    // Get coder name for branch naming (prompts on first use)
    const coderName = await getOrPromptCoderName(db)

    // Use ticket's existing branch or generate a new one
    const branch = ticket.branch || generateBranchName(ticket.id, ticket.title, coderName, agentName, ticket.category)
    const isExistingBranch = !!ticket.branch

    // Get epic and spec info
    let epicTitle: string | undefined
    let specId: string | undefined
    let specTitle: string | undefined
    let specProblem: string | undefined
    let specSolution: string | undefined
    if (ticket.epicId) {
      const epic = await this.storage.getEpic(ticket.epicId)
      epicTitle = epic?.title
    }
    if (ticket.specId) {
      const spec = await this.storage.getSpec(ticket.specId)
      if (spec) {
        specId = spec.id
        specTitle = spec.title
        specProblem = spec.problem
        specSolution = spec.solution
      }
    }

    // Get default action for batch mode (use 'implement')
    const defaultAction = await this.storage.getAction('implement')

    // Build context
    const context: ExecutionContext = {
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
      ticketPriority: ticket.priority,
      ticketCategory: ticket.category,
      epicTitle,
      specId,
      specTitle,
      specProblem,
      specSolution,
      agentName,
      agentDir,
      worktreePath,
      branch,
      hqPath: workspaceInfo.path,
      pmoPath: this.pmoPath,
      createPR: flags['create-pr'] || false,
      // Use 'implement' action for batch mode
      actionId: defaultAction?.id,
      actionName: defaultAction?.name,
      actionPrompt: defaultAction?.prompt,
      actionEndPrompt: defaultAction?.endPrompt,
      modifiesCode: defaultAction?.modifiesCode ?? true,
    }

    // Use devcontainer by default if available
    const hasDevcontainer = hasDevcontainerConfig(agentDir)
    const useDevcontainer = hasDevcontainer && !flags['run-on-host']

    // Non-interactive defaults
    const environment: ExecutionEnvironment = useDevcontainer ? 'devcontainer' : 'host'
    const displayMode: DisplayMode = 'terminal'
    const sandboxed = flags['permission-mode'] === 'safe'
    const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor
    const outputMode: OutputMode = 'interactive'

    // Handle git branch - only if action modifies code
    if (context.modifiesCode !== false) {
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]

      for (const repoPath of gitRepos) {
        if (!isGitRepo(repoPath)) {
          continue
        }

        // Fetch latest from origin (best-effort, may fail if offline)
        tryGitCommand('git fetch origin', repoPath)

        try {
          // Check if branch exists and checkout
          if (tryGitCommand(`git rev-parse --verify ${branch}`, repoPath)) {
            execSync(`git checkout ${branch}`, { cwd: repoPath, stdio: 'pipe' })
          } else {
            // Branch doesn't exist - create from best available base
            const baseBranch = findBaseBranch(repoPath)
            execSync(`git checkout -b ${branch} ${baseBranch}`, { cwd: repoPath, stdio: 'pipe' })
          }
        } catch {
          // Ignore branch errors in batch mode - continue with other repos
        }
      }

      // Save branch to ticket if newly created
      if (!isExistingBranch) {
        await this.storage.updateTicket(ticket.id, { branch })
      }
    }

    // Create execution record
    const execution = executionStorage.createExecution({
      ticketId: ticket.id,
      agentName,
      executor,
      environment,
      displayMode,
      sandboxed,
      branch,
    })

    // Note: Ticket status update moved to after successful spawn

    // Load execution config
    const executionConfig = loadExecutionConfig(db)
    executionConfig.outputMode = outputMode
    executionConfig.sandboxed = sandboxed

    // Run execution
    this.log(styles.muted(`   Starting ${ticket.id} → ${agentName}...`))

    const batchSessionManager = (flags.session || 'tmux') as SessionManager
    const result = await runExecution(environment, context, executor, executionConfig, {
      displayMode,
      sessionManager: environment === 'devcontainer' ? batchSessionManager : undefined,
    })

    if (result.success) {
      executionStorage.updateStatus(execution.id, 'running')
      executionStorage.updateProcessInfo(execution.id, {
        pid: result.pid,
        containerId: result.containerId,
        sessionId: result.sessionId,
        logPath: result.logPath,
      })

      // Update ticket assignee ONLY after successful spawn
      if (!ticket.assignee || ticket.assignee !== agentName) {
        await this.storage.updateTicket(ticket.id, { assignee: agentName })
      }

      // Move ticket to In Progress column ONLY after successful spawn
      const targetColumnName = getWorkColumnSetting(db, 'in_progress')

      const board = await this.storage.getBoard(ticket.projectId!)
      const columnNames = board.columns.map(col => col.name)
      const inProgressColumn = findColumnByName(columnNames, targetColumnName)

      if (inProgressColumn && ticket.status !== inProgressColumn) {
        await this.storage.moveTicket(ticket.projectId!, ticket.id, inProgressColumn)
      }

      await autoExportToBoard(this.pmoPath, this.storage, () => {})

      this.log(styles.success(`   ✓ ${ticket.id} started (${execution.id})`))
    } else {
      executionStorage.updateStatus(execution.id, 'failed')
      throw new Error(result.error || 'Unknown error')
    }
  }
}
