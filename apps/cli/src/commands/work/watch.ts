import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import {
  spawnForColumn,
  getAvailableAgents,
  isDockerRunning,
  AgentStrategy,
} from '../../lib/execution/spawner.js'
import { DisplayMode, ExecutionEnvironment, ExecutionConfig } from '../../lib/execution/types.js'
import { promptExecutionSettings } from '../../lib/execution/config.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class WorkWatch extends PMOCommand {
  static description = 'Watch a column and auto-spawn agents for new tickets'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --column Ready',
    '<%= config.bin %> <%= command.id %> --column Ready --strategy round-robin',
    '<%= config.bin %> <%= command.id %> --column Ready --interval 10',
    '<%= config.bin %> <%= command.id %> --column Ready --once',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to watch for new tickets (prompts if not provided)',
    }),
    strategy: Flags.string({
      char: 's',
      description: 'Agent selection strategy',
      options: ['round-robin', 'least-busy', 'random'],
      default: 'round-robin',
    }),
    agent: Flags.string({
      char: 'a',
      description: 'Use specific agent for all tickets',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum concurrent executions',
    }),
    interval: Flags.integer({
      char: 'i',
      description: 'Polling interval in seconds',
      default: 5,
    }),
    once: Flags.boolean({
      description: 'Check once and exit (no continuous watching)',
      default: false,
    }),
    mode: Flags.string({
      char: 'm',
      description: 'Display mode for agent output',
      options: ['terminal', 'foreground', 'background', 'tmux'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission prompts (danger mode)',
      default: false,
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready',
      default: false,
    }),
  }

  private isRunning = true
  private knownTickets = new Set<string>()
  private columnName = ''
  private environment: ExecutionEnvironment = 'host'
  private displayMode: DisplayMode = 'terminal'
  private executionConfig: ExecutionConfig | undefined
  private skipPermissions = false
  private createPR = false

  protected pmoLogger(): void {
    // Silent logging during watch
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkWatch)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work watch', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.')
    }

    if (workspaceInfo.agents.length === 0) {
      return handleError('NO_AGENTS', 'No agents found in workspace. Add agents first with "prlt agent add".')
    }

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    // Handle graceful shutdown
    const cleanup = async () => {
      this.isRunning = false
      this.log('')
      this.log(styles.muted('Stopping watch...'))
      db.close()
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    try {
      // Get board columns for selection
      const board = await this.storage.getBoard()
      const columns = board.columns.map(col => col.name)

      if (columns.length === 0) {
        db.close()
        this.error('No columns found in board. Initialize board first.')
      }

      // Prompt for column if not provided
      this.columnName = flags.column || ''
      if (!this.columnName) {
        // In JSON mode, output column selection prompt
        if (jsonMode) {
          const columnChoices = columns.map(col => {
            const ticketCount = board.columns.find(c => c.name === col)?.tickets?.length || 0
            return {
              name: `${col} (${ticketCount} tickets)`,
              value: col,
            }
          })
          outputPromptAsJson(
            buildPromptConfig('list', 'column', 'Select column to watch for new tickets:', columnChoices),
            createMetadata('work watch', flags)
          )
          db.close()
          return
        }

        const { selectedColumn } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedColumn',
            message: 'Select column to watch for new tickets:',
            choices: columns.map(col => {
              // Get ticket count for each column
              const ticketCount = board.columns.find(c => c.name === col)?.tickets?.length || 0
              return {
                name: `${col} (${ticketCount} tickets)`,
                value: col,
              }
            }),
          },
        ])
        this.columnName = selectedColumn
      }

      // Check if any agent has devcontainer
      const hasDevcontainer = workspaceInfo.agents.some(agent => {
        const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
        return hasDevcontainerConfig(agentDir)
      })

      // Docker check
      const dockerRunning = isDockerRunning()
      if (hasDevcontainer && !dockerRunning) {
        this.warn(
          'Docker is not running. Agents will run on host instead of devcontainer.\n' +
          'Start Docker Desktop for sandboxed execution.'
        )
      }

      // Prompt for environment and display mode if not provided
      this.environment = 'host'
      this.displayMode = 'terminal'

      if (!flags.mode) {
        if (hasDevcontainer && dockerRunning) {
          // Prompt for environment choice
          const { selectedEnvironment } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedEnvironment',
              message: 'Where should agents run?',
              choices: [
                { name: '🐳 devcontainer (sandboxed, recommended)', value: 'devcontainer' },
                { name: '💻 host (runs directly on your machine)', value: 'host' },
              ],
              default: 'devcontainer',
            },
          ])
          this.environment = selectedEnvironment
        }

        // Prompt for display mode
        const { selectedDisplay } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedDisplay',
            message: 'How should agent output be displayed?',
            choices: [
              { name: 'terminal     - New terminal window per agent (macOS)', value: 'terminal' },
              { name: 'tmux         - New tmux pane/window per agent', value: 'tmux' },
              { name: 'background   - Detached, logs to file (quiet)', value: 'background' },
              { name: 'foreground   - Run sequentially in current terminal', value: 'foreground' },
            ],
            default: 'terminal',
          },
        ])
        this.displayMode = selectedDisplay as DisplayMode
      } else {
        this.displayMode = flags.mode as DisplayMode
        this.environment = hasDevcontainer && dockerRunning ? 'devcontainer' : 'host'
      }

      // Prompt for execution settings (terminal, output mode, permissions, PR creation)
      const promptResult = await promptExecutionSettings(db, {
        displayMode: this.displayMode,
        environment: this.environment,
        skipPermissions: flags['skip-permissions'] ? true : undefined,
        createPR: flags['create-pr'] ? true : undefined,
        log: (msg) => this.log(styles.header(msg)),
      })
      this.executionConfig = promptResult.executionConfig
      this.skipPermissions = promptResult.skipPermissions
      this.createPR = promptResult.createPR

      this.log('')
      this.log(styles.header(`👁️  Watching column "${this.columnName}" for new tickets`))
      this.log('')
      this.log(styles.muted(`   Strategy: ${flags.strategy}`))
      this.log(styles.muted(`   Environment: ${this.environment}`))
      this.log(styles.muted(`   Display: ${this.displayMode}`))
      if (this.displayMode === 'terminal') {
        this.log(styles.muted(`   Terminal: ${this.executionConfig.terminal.app}`))
      }
      this.log(styles.muted(`   Output: ${this.executionConfig.outputMode === 'interactive' ? 'streaming' : 'print'}`))
      if (this.skipPermissions) {
        this.log(styles.warning(`   Permissions: ⚠️  danger`))
      } else {
        this.log(styles.success(`   Permissions: 🔒 safe`))
      }
      if (this.createPR) {
        this.log(styles.muted(`   Create PR: yes`))
      }
      if (flags.agent) {
        this.log(styles.muted(`   Agent: ${flags.agent}`))
      }
      if (flags.limit) {
        this.log(styles.muted(`   Max concurrent: ${flags.limit}`))
      }
      this.log(styles.muted(`   Interval: ${flags.interval}s`))
      this.log('')

      // Initial scan - record current tickets as "known"
      const initialTickets = await this.storage.listTickets({ column: this.columnName })
      for (const ticket of initialTickets) {
        this.knownTickets.add(ticket.id)
      }
      this.log(styles.muted(`   Found ${initialTickets.length} existing tickets in column`))

      // If --once, just do a single spawn cycle
      if (flags.once) {
        this.log('')
        const result = await spawnForColumn(
          this.columnName,
          this.storage,
          executionStorage,
          workspaceInfo,
          db,
          this.pmoPath,
          {
            strategy: flags.strategy as AgentStrategy,
            specificAgent: flags.agent,
            limit: flags.limit,
            skipPermissions: this.skipPermissions,
            createPR: this.createPR,
            environment: this.environment,
            displayMode: this.displayMode,
            executionConfig: this.executionConfig,
            log: (msg) => this.log(styles.muted(`   ${msg}`)),
          }
        )

        this.printSummary(result)
        db.close()
        return
      }

      // Continuous watching
      this.log('')
      this.log(styles.muted('Press Ctrl+C to stop watching'))
      this.log('')

      while (this.isRunning) {
        await this.pollForNewTickets(
          flags,
          executionStorage,
          workspaceInfo,
          db
        )

        // Wait for interval
        await new Promise(resolve => setTimeout(resolve, flags.interval * 1000))
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  private async pollForNewTickets(
    flags: {
      strategy: string
      agent?: string
      limit?: number
      'skip-permissions': boolean
      'create-pr': boolean
    },
    executionStorage: ExecutionStorage,
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    db: Database.Database
  ): Promise<void> {
    // Get current tickets in column
    const currentTickets = await this.storage.listTickets({ column: this.columnName })

    // Find new tickets (in current but not in known)
    const newTickets = currentTickets.filter(t => !this.knownTickets.has(t.id))

    if (newTickets.length === 0) {
      // Update status line
      const availableAgents = getAvailableAgents(workspaceInfo, executionStorage)
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const timestamp = new Date().toLocaleTimeString()

      // Clear line and show status
      process.stdout.write(`\r${styles.muted(`[${timestamp}] Watching: ${currentTickets.length} tickets | ${availableAgents.length} agents available | ${runningExecutions.length} running   `)}`)
      return
    }

    // New tickets detected!
    this.log('')
    this.log(styles.success(`✨ New tickets detected: ${newTickets.length}`))

    // Add to known set before spawning
    for (const ticket of newTickets) {
      this.knownTickets.add(ticket.id)
    }

    // Spawn agents for new tickets
    const result = await spawnForColumn(
      this.columnName,
      this.storage,
      executionStorage,
      workspaceInfo,
      db,
      this.pmoPath,
      {
        strategy: flags.strategy as AgentStrategy,
        specificAgent: flags.agent,
        limit: flags.limit,
        skipPermissions: this.skipPermissions,
        createPR: this.createPR,
        environment: this.environment,
        displayMode: this.displayMode,
        executionConfig: this.executionConfig,
        log: (msg) => this.log(styles.muted(`   ${msg}`)),
      }
    )

    // Print activity
    const timestamp = new Date().toLocaleTimeString()
    for (const spawn of result.spawned) {
      this.log(styles.success(`   [${timestamp}] ${spawn.ticketId} → ${spawn.agentName} (spawned)`))
    }
    for (const skip of result.skipped) {
      this.log(styles.warning(`   [${timestamp}] ${skip.ticketId}: ${skip.reason}`))
    }
    for (const fail of result.failed) {
      this.log(styles.error(`   [${timestamp}] ${fail.ticketId}: ${fail.error}`))
    }
    this.log('')
  }

  private printSummary(result: Awaited<ReturnType<typeof spawnForColumn>>): void {
    this.log('')
    this.log(styles.header('Summary'))
    this.log('')

    if (result.spawned.length > 0) {
      this.log(styles.success(`   ✓ Spawned: ${result.spawned.length}`))
      for (const spawn of result.spawned) {
        this.log(styles.muted(`     ${spawn.ticketId} → ${spawn.agentName}${spawn.executionId ? ` (${spawn.executionId})` : ''}`))
      }
    }

    if (result.skipped.length > 0) {
      this.log(styles.warning(`   ⏭ Skipped: ${result.skipped.length}`))
      for (const skip of result.skipped) {
        this.log(styles.muted(`     ${skip.ticketId}: ${skip.reason}`))
      }
    }

    if (result.failed.length > 0) {
      this.log(styles.error(`   ✗ Failed: ${result.failed.length}`))
      for (const fail of result.failed) {
        this.log(styles.muted(`     ${fail.ticketId}: ${fail.error}`))
      }
    }

    this.log('')
  }
}
