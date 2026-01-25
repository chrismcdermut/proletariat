import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  DisplayMode,
  SessionManager,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  TerminalApp,
  Shell,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution, isDockerRunning, isDevcontainerCliInstalled } from '../../lib/execution/runners.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { loadExecutionConfig, getTerminalApp, getShell, hasTerminalPreference, hasShellPreference } from '../../lib/execution/config.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import {
  isGHInstalled,
  isGHAuthenticated,
  getPRFeedback,
  hasPendingFeedback,
  formatPRFeedbackForPrompt,
} from '../../lib/pr/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class WorkRevise extends PMOCommand {
  static description = 'Address PR feedback on a ticket (fetches reviews/comments and spawns agent)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
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
    mode: Flags.string({
      char: 'm',
      description: 'Runtime mode',
      options: ['foreground', 'background', 'tmux', 'terminal', 'devcontainer'],
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if no pending feedback',
      default: false,
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    session: Flags.string({
      char: 's',
      description: 'Session manager inside container (tmux runs agent in tmux inside container)',
      options: ['tmux', 'direct'],
      default: 'tmux',
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkRevise)
    const projectId = (flags as { project?: string }).project

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work revise', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Check gh CLI is available
    if (!isGHInstalled() || !isGHAuthenticated()) {
      return handleError('GH_NOT_AVAILABLE', 'GitHub CLI (gh) is required for fetching PR feedback.\nRun: prlt gh login')
    }

    // Early Docker check
    if (!flags['run-on-host'] && !isDockerRunning()) {
      return handleError(
        'DOCKER_NOT_RUNNING',
        'Docker is not running.\n\n' +
        'Docker is required for devcontainer execution (recommended for agent sandboxing).\n' +
        'Please start Docker Desktop and try again.\n\n' +
        'Alternatively, use --run-on-host to run directly on your machine (bypasses sandbox).'
      )
    }

    // Early devcontainer CLI check
    if (!flags['run-on-host'] && !isDevcontainerCliInstalled()) {
      return handleError(
        'DEVCONTAINER_CLI_NOT_INSTALLED',
        'devcontainer CLI is not installed.\n\n' +
        'Install with: npm install -g @devcontainers/cli\n\n' +
        'Alternatively, use --run-on-host to run directly on your machine (bypasses sandbox).'
      )
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get ticketId - prompt with in-review tickets
      let ticketId = args.ticketId

      if (!ticketId) {
        const allTickets = await this.storage.listTickets(projectId)
        // Filter to done tickets that have a PR (may need revision based on PR feedback)
        const reviewTickets = allTickets.filter(t => {
          const isDone = t.status === 'done' || (t.statusName && t.statusName.toLowerCase().includes('done'))
          const hasPR = t.metadata?.pr_url
          return isDone && hasPR
        })

        if (reviewTickets.length === 0) {
          db.close()
          this.log(styles.info('No done tickets with PRs found.'))
          this.log(styles.muted('Use "prlt work start" for new work.'))
          return
        }

        const { selectedTicketId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTicketId',
            message: 'Select ticket to revise:',
            choices: reviewTickets.map((t) => ({
              name: `${t.id} - ${t.title}`,
              value: t.id,
            })),
          },
        ])
        ticketId = selectedTicketId
      }

      // Get ticket
      const ticket = await this.storage.getTicket(ticketId!)
      if (!ticket) {
        db.close()
        this.error(`Ticket "${ticketId}" not found.`)
      }

      // Get PR URL from ticket metadata
      const prUrl = ticket.metadata?.pr_url as string | undefined
      if (!prUrl) {
        db.close()
        this.error(`Ticket "${ticketId}" has no PR linked.\nCreate a PR first with "prlt pr create ${ticketId}".`)
      }

      // Fetch PR feedback
      this.log(styles.muted('Fetching PR feedback...'))
      const feedback = getPRFeedback(prUrl)
      if (!feedback) {
        db.close()
        this.error(`Could not fetch PR feedback for ${prUrl}`)
      }

      // Check if there's actually feedback to address
      if (!hasPendingFeedback(feedback) && !flags.force) {
        db.close()
        this.log(styles.success('No pending feedback to address!'))
        this.log(styles.muted(`PR: ${feedback.prUrl}`))
        this.log(styles.muted('Use --force to start revision anyway.'))
        return
      }

      // Format feedback for prompt
      const formattedFeedback = formatPRFeedbackForPrompt(feedback)

      // Get assignee
      const agentName = ticket.assignee
      if (!agentName) {
        db.close()
        this.error(`Ticket "${ticketId}" has no assignee. Assign an agent first.`)
      }

      // Check if agent exists
      const agentInfo = workspaceInfo.agents.find((a) => a.name === agentName)
      if (!agentInfo) {
        db.close()
        this.error(
          `Agent "${agentName}" not found in workspace.\n` +
          `Add agent first with "prlt agent add ${agentName}"`
        )
      }

      // Check for running execution
      const runningExecution = executionStorage.getRunningExecution(ticketId!)
      if (runningExecution) {
        db.close()
        this.error(
          `Ticket "${ticketId}" already has work in progress: ${runningExecution.id}\n` +
          `Stop it first with "prlt work stop ${runningExecution.id}"`
        )
      }

      // Find worktree path
      const agentDir = path.join(workspaceInfo.agentsPath, agentName)
      if (!fs.existsSync(agentDir)) {
        db.close()
        this.error(`Agent directory not found at ${agentDir}.`)
      }

      let worktreePath = agentDir
      const agentContents = fs.readdirSync(agentDir)
      const repoWorktrees = agentContents.filter(item => {
        const itemPath = path.join(agentDir, item)
        const gitPath = path.join(itemPath, '.git')
        return fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)
      })

      if (repoWorktrees.length === 1) {
        worktreePath = path.join(agentDir, repoWorktrees[0])
      } else if (repoWorktrees.length > 1) {
        worktreePath = agentDir
        this.log(styles.muted(`   Repos: ${repoWorktrees.join(', ')}`))
      } else {
        this.log(styles.muted(`   No git worktree found, using current directory`))
        worktreePath = process.cwd()
      }

      // Get branch from ticket metadata or current branch
      const branch = (ticket.metadata?.pr_branch as string) || this.getCurrentBranch(worktreePath)

      // Build execution context
      const hqPath = path.dirname(this.pmoPath)
      const context: ExecutionContext = {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
        ticketPriority: ticket.priority,
        ticketCategory: ticket.category,
        agentName,
        agentDir,
        worktreePath,
        branch,
        hqPath,
        // Revision-specific context
        isRevision: true,
        prFeedback: formattedFeedback,
      }

      // Determine execution environment and display mode
      const hasDevcontainer = hasDevcontainerConfig(agentDir)
      let environment: ExecutionEnvironment = 'host'
      let displayMode: DisplayMode = 'terminal'
      let sandboxed = false

      if (hasDevcontainer && !flags['run-on-host']) {
        environment = 'devcontainer'

        const { selectedDisplay } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedDisplay',
            message: 'How should the agent output be displayed?',
            choices: [
              { name: 'terminal     - New terminal window', value: 'terminal' },
              { name: 'background   - Runs detached, reattach with: prlt session attach', value: 'background' },
            ],
            default: 'terminal',
          },
        ])
        displayMode = selectedDisplay as DisplayMode
      } else if (flags.mode) {
        // Host environment: terminal/background are display modes
        displayMode = flags.mode as DisplayMode
      }

      // Permission mode
      const { permissionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'permissionMode',
          message: 'Permission mode for Claude Code:',
          choices: [
            { name: 'danger - Skip permission checks (faster for revisions)', value: 'danger' },
            { name: 'safe   - Requires approval for dangerous operations', value: 'safe' },
          ],
          default: 'danger',
        },
      ])
      sandboxed = permissionMode === 'safe'

      const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

      // Show execution info
      this.log('')
      this.log(styles.header(`Revising: ${ticket.id}: ${ticket.title}`))
      this.log(styles.muted(`   Agent: ${agentName}`))
      this.log(styles.muted(`   PR: ${feedback.prUrl}`))
      this.log(styles.muted(`   Reviews: ${feedback.reviews.length}`))
      this.log(styles.muted(`   Comments: ${feedback.comments.length}`))
      this.log(styles.muted(`   Environment: ${environment}`))
      this.log('')

      // Checkout branch in worktree(s)
      this.log(styles.muted('Checking out branch...'))
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]

      for (const repoPath of gitRepos) {
        const repoName = path.basename(repoPath)
        try {
          execSync(`git checkout ${branch}`, {
            cwd: repoPath,
            stdio: 'pipe',
          })
          this.log(styles.muted(`   ${repoName}: checked out ${branch}`))
        } catch {
          this.warn(`Could not checkout ${branch} in ${repoName}`)
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

      this.log(styles.muted(`   Work ID: ${execution.id}`))
      this.log('')

      // Move ticket back to In Progress column
      const inProgressColumnName = getWorkColumnSetting(db, 'in_progress')

      const board = await this.storage.getBoard(ticket.projectId!)
      const columnNames = board.columns.map(col => col.name)
      const inProgressColumn = findColumnByName(columnNames, inProgressColumnName)

      if (inProgressColumn && ticket.statusName !== inProgressColumn) {
        await this.storage.moveTicket(ticket.projectId!, ticket.id, inProgressColumn)
        this.log(styles.muted(`   Moved to: ${inProgressColumn}`))
      }

      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      // Load execution config
      const executionConfig = loadExecutionConfig(db)

      // Configure terminal if needed (for terminal display mode)
      if (displayMode === 'terminal') {
        const needsTerminal = !hasTerminalPreference(db)
        const needsShell = !hasShellPreference(db)

        let terminalApp: TerminalApp
        let shell: Shell

        if (needsTerminal || needsShell) {
          terminalApp = await getTerminalApp(db)
          shell = await getShell(db)
        } else {
          terminalApp = await getTerminalApp(db)
          shell = await getShell(db)
        }

        executionConfig.terminal.app = terminalApp
        executionConfig.shell = shell
      }

      executionConfig.outputMode = 'interactive' as OutputMode
      executionConfig.sandboxed = sandboxed

      // Run execution
      this.log(styles.muted('Starting agent to address feedback...'))
      const sessionManager = (flags.session || 'tmux') as SessionManager
      const result = await runExecution(environment, context, executor, executionConfig, {
        displayMode,
        sessionManager: environment === 'devcontainer' ? sessionManager : undefined,
      })

      if (result.success) {
        executionStorage.updateStatus(execution.id, 'running')
        executionStorage.updateProcessInfo(execution.id, {
          pid: result.pid,
          containerId: result.containerId,
          sessionId: result.sessionId,
          logPath: result.logPath,
        })

        this.log('')
        this.log(styles.success(`Revision started (${execution.id})`))
        this.log('')
        this.log(styles.muted('Commands:'))
        this.log(styles.muted(`  prlt work status              View work status`))
        this.log(styles.muted(`  prlt work stop ${execution.id}    Stop work`))
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start revision: ${result.error}`)
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  private getCurrentBranch(cwd: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      return 'main'
    }
  }
}
