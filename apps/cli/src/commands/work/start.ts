import { Command, Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js'
import { StateCategory, WorkAction } from '../../lib/pmo/types.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  RuntimeMode,
  DisplayMode,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  TerminalApp,
  Shell,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution, isDockerRunning } from '../../lib/execution/runners.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { loadExecutionConfig, getTerminalApp, promptTerminalPreference, getShell, promptShellPreference, hasTerminalPreference, hasShellPreference } from '../../lib/execution/config.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import { isGHInstalled, isGHAuthenticated } from '../../lib/pr/index.js'

export default class WorkStart extends Command {
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
    all: Flags.boolean({
      char: 'a',
      description: 'Start work on all unassigned backlog tickets (batch mode)',
      default: false,
    }),
    mode: Flags.string({
      char: 'm',
      description: 'Runtime mode',
      options: ['foreground', 'background', 'tmux', 'terminal', 'devcontainer', 'docker', 'vm'],
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
    'skip-permissions': Flags.boolean({
      description: 'Skip permission prompts (danger mode)',
      default: false,
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
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkStart)

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Get PMO context (filter out projects with no tickets)
    const { pmoPath, storage } = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
      promptIfMultiple: true,
      filterEmptyProjects: true,
    })

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Handle batch mode (--all)
      if (flags.all) {
        await this.runBatchMode(workspaceInfo, pmoPath, storage, db, executionStorage, flags)
        return
      }

      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId

      if (!ticketId) {
        // Get all tickets
        const allTickets = await storage.listTickets()

        if (allTickets.length === 0) {
          await storage.close()
          db.close()
          this.error('No tickets found. Create a ticket first with "prlt ticket create".')
        }

        const { selectedTicketId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTicketId',
            message: 'Select ticket to work on:',
            choices: allTickets.map((t) => ({
              name: `${t.id} - ${t.title} (${t.assignee ? `assignee: ${t.assignee}` : 'unassigned'})`,
              value: t.id,
            })),
          },
        ])
        ticketId = selectedTicketId
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!)
      if (!ticket) {
        await storage.close()
        db.close()
        this.error(`Ticket "${ticketId}" not found.`)
      }

      // Check if ticket is blocked by dependencies
      const isBlocked = await storage.isTicketBlocked(ticketId!)
      if (isBlocked && !flags.force) {
        const blockers = await storage.getTicketBlockers(ticketId!)
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
          await storage.close()
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }
      }

      // Check assignee - prompt if not set
      let agentName = ticket.assignee
      if (!agentName) {
        // Get list of busy agents (already running something)
        const busyAgentNames = new Set<string>()
        for (const agent of workspaceInfo.agents) {
          const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
          if (runningExecutions.length > 0) {
            busyAgentNames.add(agent.name)
          }
        }

        // Prompt to assign an agent
        const agentChoices: Array<{ name: string; value: string; disabled?: string } | inquirer.Separator> = []

        const availableAgents = workspaceInfo.agents.filter(a => !busyAgentNames.has(a.name))
        const busyAgents = workspaceInfo.agents.filter(a => busyAgentNames.has(a.name))

        if (availableAgents.length > 0) {
          agentChoices.push(new inquirer.Separator('── Available Agents ──'))
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

        agentChoices.push(new inquirer.Separator('── Other ──'))
        agentChoices.push({ name: 'Enter custom name...', value: '__custom__' })

        const { selectedAgent } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedAgent',
            message: `Ticket "${ticketId}" has no assignee. Select agent:`,
            choices: agentChoices,
          },
        ])

        if (selectedAgent === '__custom__') {
          const { customAgent } = await inquirer.prompt([
            {
              type: 'input',
              name: 'customAgent',
              message: 'Enter agent name:',
              validate: (input: string) => input.trim() ? true : 'Name cannot be empty',
            },
          ])
          agentName = customAgent.trim()
        } else {
          agentName = selectedAgent
        }

        // Update ticket with assignee
        await storage.updateTicket(ticketId!, { assignee: agentName })
        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
        this.log(styles.muted(`Assigned ${ticketId} to ${agentName}`))
      }

      // At this point agentName is guaranteed to be set
      const assignedAgent = agentName as string

      // Check if agent exists in workspace
      const agentInfo = workspaceInfo.agents.find((a) => a.name === assignedAgent)
      if (!agentInfo) {
        await storage.close()
        db.close()
        this.error(
          `Agent "${assignedAgent}" not found in workspace.\n` +
            `Add agent first with "prlt agents add ${assignedAgent}"`
        )
      }

      // Check for running execution on this ticket
      const runningExecution = executionStorage.getRunningExecution(ticketId!)
      if (runningExecution && !flags.force) {
        await storage.close()
        db.close()
        this.error(
          `Ticket "${ticketId}" already has work in progress: ${runningExecution.id}\n` +
            `Use --force to start another, or stop with "prlt work stop ${runningExecution.id}"`
        )
      }

      // Check if agent is already working on something else
      const agentRunningExecutions = executionStorage.getAgentRunningExecutions(assignedAgent)
      if (agentRunningExecutions.length > 0 && !flags.force) {
        const execInfo = agentRunningExecutions.map(e => `  ${e.id}: ${e.ticketId}`).join('\n')
        await storage.close()
        db.close()
        this.error(
          `Agent "${assignedAgent}" is already working on other tickets:\n${execInfo}\n\n` +
            `Use --force to start anyway, or stop existing work first.`
        )
      }

      // Determine worktree path
      // Agent directory structure varies:
      // - HQ with repos: {agentsPath}/{agent}/{repoName}/ (git worktree per repo)
      // - Workspace-only: {agentsPath}/{agent}/{repoName}/ (git worktree)
      // - HQ without repos: {agentsPath}/{agent}/ (placeholder, use cwd)
      const agentDir = path.join(workspaceInfo.agentsPath, assignedAgent)
      if (!fs.existsSync(agentDir)) {
        await storage.close()
        db.close()
        this.error(
          `Agent directory not found at ${agentDir}.\n` +
            `Create agent with "prlt agents add ${assignedAgent}"`
        )
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

      // Use ticket's existing branch or generate a new one
      const branch = ticket.branch || generateBranchName(
        ticket.id,
        ticket.title,
        assignedAgent,
        ticket.category
      )
      const isExistingBranch = !!ticket.branch

      // Get epic info if linked
      let epicTitle: string | undefined
      if (ticket.epicId) {
        const epic = await storage.getEpic(ticket.epicId)
        epicTitle = epic?.title
      }

      // Get spec info if linked
      let specId: string | undefined
      let specTitle: string | undefined
      let specProblem: string | undefined
      let specSolution: string | undefined
      if (ticket.specId) {
        const spec = await storage.getSpec(ticket.specId)
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
        selectedAction = await storage.getAction(flags.action)
        if (!selectedAction) {
          await storage.close()
          db.close()
          this.error(`Action not found: ${flags.action}. Use "prlt action list" to see available actions.`)
        }
      } else {
        // Interactive action selection
        // Get ticket's current status to determine suggested action
        const ticketStatus = await storage.getStatus(ticket.statusId || '')
        const currentCategory: StateCategory = ticketStatus?.category || 'unstarted'

        // Get suggested action for this category
        const suggestedAction = await storage.getSuggestedAction(currentCategory)

        // Get all actions for selection
        const allActions = await storage.listActions()

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
        } else {
          selectedAction = await storage.getAction(selectedActionId)
        }
      }

      // Build execution context with full ticket details
      // HQ path is parent of pmoPath (pmoPath is <hq>/pmo)
      const hqPath = path.dirname(pmoPath)
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
        pmoPath,          // PMO path for container mounting
        // Action context
        actionId: selectedAction?.id,
        actionName: selectedAction?.name || (customPrompt ? 'Custom' : undefined),
        actionPrompt: customPrompt || selectedAction?.prompt,
        modifiesCode: customPrompt ? true : selectedAction?.modifiesCode ?? true,
      }

      // Check if agent has devcontainer config
      const hasDevcontainer = hasDevcontainerConfig(agentDir)

      // Use devcontainer by default if available, unless --run-on-host is set
      const useDevcontainer = hasDevcontainer && !flags['run-on-host']

      // Determine runtime mode
      let mode: RuntimeMode = 'terminal'
      let displayMode: DisplayMode = 'terminal'
      let environment: ExecutionEnvironment = 'host'
      let sandboxed = false  // Whether --dangerously-skip-permissions is NOT used

      if (hasDevcontainer && !flags.mode && !flags['run-on-host']) {
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
            await storage.close()
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
            environment = 'devcontainer'
            // Pick display mode for devcontainer
            const { selectedDisplay } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedDisplay',
                message: 'How should the agent output be displayed?',
                choices: [
                  { name: 'terminal     - New terminal window (macOS)', value: 'terminal' },
                  { name: 'foreground   - Run in current terminal', value: 'foreground' },
                  { name: 'tmux         - New tmux pane/window', value: 'tmux' },
                  { name: 'background   - Detached process, logs to file', value: 'background' },
                ],
                default: 'terminal',
              },
            ])
            displayMode = selectedDisplay as DisplayMode
            mode = 'devcontainer'
            environmentSelected = true
          } else {
            // User chose host - fall through to host mode selection
            environment = 'host'
            const { selectedMode } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedMode',
                message: 'Select execution mode:',
                choices: [
                  { name: 'terminal     - New terminal window (macOS)', value: 'terminal' },
                  { name: 'foreground   - Run in current terminal', value: 'foreground' },
                  { name: 'tmux         - New tmux pane/window', value: 'tmux' },
                  { name: 'background   - Detached process, logs to file', value: 'background' },
                ],
                default: DEFAULT_EXECUTION_CONFIG.defaultMode,
              },
            ])
            mode = selectedMode as RuntimeMode
            displayMode = mode as DisplayMode
            environmentSelected = true
          }
        }
      } else if (useDevcontainer) {
        // Devcontainer with explicit mode flag
        environment = 'devcontainer'
        if (flags.mode && ['terminal', 'foreground', 'background', 'tmux'].includes(flags.mode)) {
          displayMode = flags.mode as DisplayMode
        } else if (flags.mode === 'devcontainer') {
          displayMode = 'foreground'
        }
        mode = 'devcontainer'
      } else {
        // No devcontainer or --run-on-host - host mode selection
        if (flags.mode) {
          mode = flags.mode as RuntimeMode
          // Set environment based on mode
          if (mode === 'docker') {
            environment = 'docker'
          } else if (mode === 'vm') {
            environment = 'vm'
          } else {
            environment = 'host'
          }
          displayMode = mode as DisplayMode
        } else {
          const warningMsg = flags['run-on-host']
            ? 'Select execution mode (--run-on-host: bypassing devcontainer):'
            : 'Select execution mode (no devcontainer - running on host):'

          const { selectedMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedMode',
              message: warningMsg,
              choices: [
                { name: 'terminal     - New terminal window (macOS)', value: 'terminal' },
                { name: 'foreground   - Run in current terminal', value: 'foreground' },
                { name: 'tmux         - New tmux pane/window', value: 'tmux' },
                { name: 'background   - Detached process, logs to file', value: 'background' },
                new inquirer.Separator('── Sandboxed (requires setup) ──'),
                { name: 'docker       - Container with worktree mounted', value: 'docker' },
                new inquirer.Separator('── Remote ──'),
                { name: 'vm           - Remote VM via SSH', value: 'vm' },
              ],
              default: DEFAULT_EXECUTION_CONFIG.defaultMode,
            },
          ])
          mode = selectedMode as RuntimeMode
          // Set environment based on mode
          if (mode === 'docker') {
            environment = 'docker'
          } else if (mode === 'vm') {
            environment = 'vm'
          } else {
            environment = 'host'
          }
          displayMode = mode as DisplayMode
        }
      }

      const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

      // Prompt for output mode (interactive vs print)
      // Only show this for display modes where streaming makes sense (terminal, tmux, foreground)
      let outputMode: OutputMode = DEFAULT_EXECUTION_CONFIG.outputMode
      const streamingDisplayModes: DisplayMode[] = ['terminal', 'tmux', 'foreground']
      const currentDisplayMode = mode === 'devcontainer' ? displayMode : mode as DisplayMode

      if (flags.output) {
        // Use flag value
        outputMode = flags.output as OutputMode
      } else if (streamingDisplayModes.includes(currentDisplayMode)) {
        const { selectedOutputMode } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedOutputMode',
            message: 'How should Claude display output?',
            choices: [
              { name: 'interactive  - Watch Claude work in real-time (streaming UI)', value: 'interactive' },
              { name: 'print        - Show final result only (better for logs)', value: 'print' },
            ],
            default: 'interactive',
          },
        ])
        outputMode = selectedOutputMode as OutputMode
      }

      // Prompt for permissions mode (all environments)
      // Skip prompt if --skip-permissions flag is set
      if (flags['skip-permissions']) {
        sandboxed = false
      } else {
        const containerNote = (environment === 'devcontainer' || environment === 'docker')
          ? ' (container provides additional isolation)'
          : ''
        const { permissionMode } = await inquirer.prompt([
          {
            type: 'list',
            name: 'permissionMode',
            message: `Permission mode for Claude Code${containerNote}:`,
            choices: [
              { name: '🔒 safe   - Requires approval for dangerous operations (recommended)', value: 'safe' },
              { name: '⚠️  danger - Skip permission checks (--dangerously-skip-permissions)', value: 'danger' },
            ],
            default: 'safe',
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
      const envIcon = environment === 'devcontainer' ? '🐳' : (environment === 'docker' ? '📦' : '💻')
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

      // Handle git branch - only if action modifies code
      let finalBranch = branch
      if (context.modifiesCode !== false) {
        // If we have multiple repo worktrees, use the first for branch detection
        const gitRepos = repoWorktrees.length > 0
          ? repoWorktrees.map(r => path.join(agentDir, r))
          : [worktreePath]
        const primaryRepo = gitRepos[0]

        if (isExistingBranch) {
          // Ticket already has a branch linked - just use it
          this.log(styles.muted(`Using existing branch: ${branch}`))
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
          try {
            // Check if this is a git repo
            try {
              execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' })
            } catch {
              continue
            }

            // Check if branch exists in git
            try {
              execSync(`git rev-parse --verify ${finalBranch}`, {
                cwd: repoPath,
                stdio: 'pipe',
              })
              execSync(`git checkout ${finalBranch}`, {
                cwd: repoPath,
                stdio: 'pipe',
              })
              this.log(styles.muted(`   ${repoName}: checked out branch`))
            } catch {
              execSync(`git checkout -b ${finalBranch}`, {
                cwd: repoPath,
                stdio: 'pipe',
              })
              this.log(styles.muted(`   ${repoName}: created new branch`))
            }
          } catch (error) {
            this.warn(`Could not handle branch in ${repoName}: ${error instanceof Error ? error.message : error}`)
          }
        }

        // Save branch to ticket
        if (!isExistingBranch || finalBranch !== branch) {
          await storage.updateTicket(ticket.id, { branch: finalBranch })
        }

        // Update context with final branch
        context.branch = finalBranch
      } else {
        this.log(styles.muted('Skipping branch (action does not modify code)'))
      }

      // Create execution record
      const execution = executionStorage.createExecution({
        ticketId: ticket.id,
        agentName: assignedAgent,
        executor,
        mode,
        environment,
        displayMode,
        sandboxed,
        branch,
      })

      this.log(styles.muted(`   Work ID: ${execution.id}`))
      this.log('')

      // Update ticket status and move to configured In Progress column
      await storage.updateTicket(ticket.id, { status: 'in_progress' })

      // Get configured column name (from pmo_settings or default)
      const targetColumnName = getWorkColumnSetting(db, 'in_progress')
      const board = await storage.getBoard()
      const columnNames = board.columns.map(col => col.name)
      const inProgressColumn = findColumnByName(columnNames, targetColumnName)

      if (inProgressColumn && ticket.column !== inProgressColumn) {
        await storage.moveTicket(ticket.id, inProgressColumn)
        this.log(styles.muted(`   Moved to: ${inProgressColumn}`))
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      // Load execution config from database
      const executionConfig = loadExecutionConfig(db)

      // If terminal display mode, ensure terminal and shell preferences are set (prompts on first use)
      // Also re-prompt if --reconfigure flag is set
      const needsTerminalConfig = (mode === 'terminal') || (useDevcontainer && displayMode === 'terminal')
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
      const result = await runExecution(mode, context, executor, executionConfig, {
        host: flags['vm-host'],
        displayMode: mode === 'devcontainer' ? displayMode : undefined,
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

        // Track container in containers table (for devcontainer mode)
        if (mode === 'devcontainer' && result.containerId) {
          const containerStorage = new ContainerStorage(db)
          containerStorage.upsertContainer({
            agentName: context.agentName,
            dockerId: result.containerId,
            status: 'running',
            currentExecutionId: execution.id,
          })
        }

        this.log('')
        this.log(styles.success(`✓ Work started (${execution.id})`))
        this.log('')

        if (mode !== 'foreground') {
          this.log(styles.muted('Commands:'))
          this.log(styles.muted(`  prlt work status              View work status`))
          this.log(styles.muted(`  prlt work ready ${ticketId}     Mark ready for review`))
          this.log(styles.muted(`  prlt work stop ${execution.id}    Stop work`))
        }
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start work: ${result.error}`)
      }

      await storage.close()
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
    pmoPath: string,
    storage: Awaited<ReturnType<typeof getPMOContext>>['storage'],
    db: Database.Database,
    executionStorage: ExecutionStorage,
    flags: { mode?: string; executor?: string; 'vm-host'?: string; 'run-on-host': boolean; force: boolean }
  ): Promise<void> {
    // Get all tickets and filter to unassigned backlog/planned (not in progress)
    const allTickets = await storage.listTickets()
    const backlogTickets = allTickets.filter(t =>
      !t.assignee && (t.status === 'backlog' || t.status === 'planned' || !t.status)
    )

    if (backlogTickets.length === 0) {
      await storage.close()
      db.close()
      this.log(styles.muted('No unassigned backlog tickets to start.'))
      return
    }

    this.log('')
    this.log(styles.header(`🚀 Batch Start: ${backlogTickets.length} backlog tickets`))
    this.log('')

    // Get available agents
    const busyAgentNames = new Set<string>()
    for (const agent of workspaceInfo.agents) {
      const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
      if (runningExecutions.length > 0) {
        busyAgentNames.add(agent.name)
      }
    }

    const availableAgents = workspaceInfo.agents.filter(a => !busyAgentNames.has(a.name))

    if (availableAgents.length === 0) {
      await storage.close()
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
      await storage.close()
      db.close()
      this.log(styles.muted('Cancelled.'))
      return
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
        await this.config.runCommand('work:start', [
          ticket.id,
          '--mode', flags.mode || 'background',
          ...(flags.executor ? ['--executor', flags.executor] : []),
          ...(flags['run-on-host'] ? ['--run-on-host'] : []),
          ...(flags.force ? ['--force'] : []),
        ])

        successCount++
      } catch (error) {
        failCount++
        this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
      }
    }

    await storage.close()
    db.close()

    this.log('')
    this.log(styles.success(`✓ Batch complete: ${successCount} started, ${failCount} failed`))

    const remaining = backlogTickets.length - assignments.length
    if (remaining > 0) {
      this.log(styles.muted(`   ${remaining} ticket(s) remain in backlog (no available agents)`))
    }
  }
}
