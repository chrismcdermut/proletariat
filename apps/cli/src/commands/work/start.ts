import { Command, Args, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js'
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
import { ExecutionStorage } from '../../lib/execution/storage.js'
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
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
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
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkStart)

    // Early Docker check - fail fast if Docker is needed but not running
    // This avoids user going through ticket/agent selection only to fail at the end
    if (!flags['run-on-host'] && !isDockerRunning()) {
      this.error(
        'Docker is not running.\n\n' +
        'Docker is required for devcontainer execution (recommended for agent sandboxing).\n' +
        'Please start Docker Desktop and try again.\n\n' +
        'Alternatively, use --run-on-host to run directly on your machine (bypasses sandbox).'
      )
    }

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch (error) {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Get PMO context
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
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

      // Generate branch name
      const branch = generateBranchName(
        ticket.id,
        ticket.title,
        assignedAgent,
        ticket.category
      )

      // Get epic info if linked
      let epicTitle: string | undefined
      if (ticket.epicId) {
        const epic = await storage.getEpic(ticket.epicId)
        epicTitle = epic?.title
      }

      // Get spec info if linked
      let specPath: string | undefined
      if (ticket.specId) {
        const spec = await storage.getSpec(ticket.specId)
        specPath = spec?.path
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
        specPath,
        agentName: assignedAgent,
        agentDir,         // Agent directory (contains .devcontainer)
        worktreePath,     // Worktree path (may be subdirectory of agentDir)
        branch,
        hqPath,
        pmoPath,          // PMO path for container mounting
      }

      // Check if agent has devcontainer config
      const hasDevcontainer = hasDevcontainerConfig(agentDir)

      // Use devcontainer by default if available, unless --run-on-host is set
      const useDevcontainer = hasDevcontainer && !flags['run-on-host']

      // Determine runtime mode
      let mode: RuntimeMode
      let displayMode: DisplayMode = 'terminal'
      let environment: ExecutionEnvironment = 'host'
      let sandboxed = false  // Whether --dangerously-skip-permissions is NOT used

      if (hasDevcontainer && !flags.mode && !flags['run-on-host']) {
        // Agent has devcontainer - prompt for environment choice
        const { selectedEnvironment } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedEnvironment',
            message: 'Where should the agent run?',
            choices: [
              { name: '🐳 devcontainer (sandboxed, recommended)', value: 'devcontainer' },
              { name: '💻 host (runs directly on your machine)', value: 'host' },
            ],
            default: 'devcontainer',
          },
        ])

        if (selectedEnvironment === 'devcontainer') {
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

      if (streamingDisplayModes.includes(currentDisplayMode)) {
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
      // Use flag if provided, otherwise prompt
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

      // Create branch in worktree(s)
      this.log(styles.muted('Creating branch...'))

      // If we have multiple repo worktrees, create branch in each
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]  // Single repo or cwd fallback

      for (const repoPath of gitRepos) {
        const repoName = path.basename(repoPath)
        try {
          // Check if this is a git repo
          try {
            execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' })
          } catch {
            // Not a git repo, skip
            continue
          }

          // Check if branch exists
          try {
            execSync(`git rev-parse --verify ${branch}`, {
              cwd: repoPath,
              stdio: 'pipe',
            })
            // Branch exists, check it out
            execSync(`git checkout ${branch}`, {
              cwd: repoPath,
              stdio: 'pipe',
            })
            this.log(styles.muted(`   ${repoName}: checked out existing branch`))
          } catch {
            // Branch doesn't exist, create it
            execSync(`git checkout -b ${branch}`, {
              cwd: repoPath,
              stdio: 'pipe',
            })
            this.log(styles.muted(`   ${repoName}: created new branch`))
          }
        } catch (error) {
          this.warn(`Could not create branch in ${repoName}: ${error instanceof Error ? error.message : error}`)
        }
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
}
