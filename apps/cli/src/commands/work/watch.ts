import { Flags } from '@oclif/core'
import type Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo, resolveAgentDir } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import {
  spawnForColumn,
  getAvailableAgents,
  isDockerRunning,
  isDevcontainerCliInstalled,
  AgentStrategy,
} from '../../lib/execution/spawner.js'
import { DisplayMode, ExecutionEnvironment, ExecutionConfig, PermissionMode } from '../../lib/execution/types.js'
import { promptExecutionSettings } from '../../lib/execution/config.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { FlagResolver } from '../../lib/flags/index.js'
import { onShutdown } from '../../lib/signal-handler.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'

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
      min: 1,
    }),
    interval: Flags.integer({
      char: 'i',
      description: 'Polling interval in seconds',
      default: 5,
      min: 1,
    }),
    'run-mode': Flags.string({
      description: 'Run mode (once=single poll cycle, continuous=keep watching)',
      options: ['once', 'continuous'],
      default: 'continuous',
    }),
    once: Flags.boolean({
      description: '[deprecated: use --run-mode once] Check once and exit',
      default: false,
      hidden: true,
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode for agent output',
      options: ['terminal', 'background'],
    }),
    mode: Flags.string({
      description: '[deprecated: use --display] Display mode for agent output',
      options: ['terminal', 'background'],
      hidden: true,
    }),
    permissions: Flags.string({
      description: 'Permission handling mode (skip=danger mode, ask=require approval)',
      options: ['skip', 'ask'],
    }),
    'skip-permissions': Flags.boolean({
      description: '[deprecated: use --permissions skip] Skip permission prompts',
      default: false,
      hidden: true,
    }),
    pr: Flags.string({
      description: 'PR creation behavior (create=open PR when ready, skip=no PR)',
      options: ['create', 'skip'],
    }),
    'create-pr': Flags.boolean({
      description: '[deprecated: use --pr create] Create PR when work is ready',
      default: false,
      hidden: true,
    }),
  }

  private isRunning = true
  private knownTickets = new Set<string>()
  private columnName = ''
  private projectId = ''
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

    // === Deprecated flag resolution (backward compat) ===
    // --once → --run-mode once
    if (flags.once && flags['run-mode'] === 'continuous') flags['run-mode'] = 'once'
    if (flags['run-mode'] === 'once') flags.once = true
    // --mode → --display (renamed)
    if (flags.mode && !flags.display) flags.display = flags.mode
    // --skip-permissions → --permissions skip
    if (flags['skip-permissions'] && !flags.permissions) flags.permissions = 'skip'
    if (flags.permissions === 'skip') flags['skip-permissions'] = true
    // --create-pr → --pr create
    if (flags['create-pr'] && !flags.pr) flags.pr = 'create'
    if (flags.pr === 'create') flags['create-pr'] = true

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work watch', flags))
        return
      }
      this.error(message)
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.')
    }

    if (workspaceInfo.agents.length === 0) {
      return handleError('NO_AGENTS', 'No agents found in workspace. Add agents first with "prlt agent add".')
    }

    // Get project
    this.projectId = await this.requireProject()

    // Open database for execution storage
    const db = openWorkspaceDatabase(workspaceInfo.path)
    const executionStorage = new ExecutionStorage(db)

    // Register graceful shutdown via centralized signal handler
    onShutdown(() => {
      this.isRunning = false
      db.close()
    })

    try {
      // Get board columns for selection
      const board = await this.storage.getBoard(this.projectId)
      const columns = board.columns.map(col => col.name)

      if (columns.length === 0) {
        db.close()
        this.error('No columns found in board. Initialize board first.')
      }

      // Prompt for column if not provided
      this.columnName = flags.column || ''
      if (!this.columnName) {
        // Build column choices with ticket counts
        const columnChoices = columns.map(col => {
          const ticketCount = board.columns.find(c => c.name === col)?.tickets?.length || 0
          return {
            name: `${col} (${ticketCount} tickets)`,
            value: col,
          }
        })

        // Use FlagResolver for column selection
        const columnResolver = new FlagResolver<{ column?: string }>({
          commandName: 'work watch',
          baseCommand: 'prlt work watch',
          jsonMode,
          flags: {},
        })

        columnResolver.addPrompt({
          flagName: 'column',
          type: 'list',
          message: 'Select column to watch for new tickets:',
          choices: () => columnChoices,
        })

        const columnResult = await columnResolver.resolve()
        this.columnName = columnResult.column || ''
      }

      // Check if any agent has devcontainer
      const hasDevcontainer = workspaceInfo.agents.some(agent => {
        const agentDir = resolveAgentDir(workspaceInfo, agent.name)
        return hasDevcontainerConfig(agentDir)
      })

      // Prompt for environment and display mode if not provided
      this.environment = 'host'
      this.displayMode = 'terminal'

      if (!flags.display) {
        if (hasDevcontainer) {
          const envChoices = [
            { name: '🐳 devcontainer (isolated, recommended)', value: 'devcontainer' },
            { name: '💻 host (runs directly on your machine)', value: 'host' },
          ]

          if (jsonMode) {
            // In JSON mode, use FlagResolver (outputs prompt and exits)
            const envResolver = new FlagResolver<{ selectedEnvironment?: string }>({
              commandName: 'work watch',
              baseCommand: 'prlt work watch',
              jsonMode,
              flags: {},
            })

            envResolver.addPrompt({
              flagName: 'selectedEnvironment',
              type: 'list',
              message: 'Where should agents run?',
              default: 'devcontainer',
              choices: () => envChoices,
            })

            await envResolver.resolve()
            return // unreachable, but satisfies TypeScript
          }

          // Interactive mode: loop to handle Docker not running
          let environmentSelected = false
          while (!environmentSelected) {
            // eslint-disable-next-line no-await-in-loop -- Interactive loop with retry on Docker check
            const { selectedEnvironment } = await this.prompt<{ selectedEnvironment: string }>([
              {
                type: 'list',
                name: 'selectedEnvironment',
                message: 'Where should agents run?',
                choices: envChoices,
                default: 'devcontainer',
              },
            ], null)

            if (selectedEnvironment === 'devcontainer') {
              // Dynamically check Docker when selected (user may have started it)
              if (!isDockerRunning()) {
                this.log('')
                this.warn('Docker is not running. Please start Docker and try again.')
                this.log('')
                continue
              }

              if (!isDevcontainerCliInstalled()) {
                this.log('')
                this.warn(
                  'devcontainer CLI is not installed.\n' +
                  'Install with: npm install -g @devcontainers/cli\n' +
                  'Or select "host" to run directly on your machine.'
                )
                this.log('')
                continue
              }
            }

            this.environment = selectedEnvironment as ExecutionEnvironment
            environmentSelected = true
          }
        }

        // Use FlagResolver for display mode
        const displayResolver = new FlagResolver<{ selectedDisplay?: string }>({
          commandName: 'work watch',
          baseCommand: 'prlt work watch',
          jsonMode,
          flags: {},
        })

        displayResolver.addPrompt({
          flagName: 'selectedDisplay',
          type: 'list',
          message: 'How should agent output be displayed?',
          default: 'terminal',
          choices: () => [
            { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
            { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
          ],
        })

        const displayResult = await displayResolver.resolve()
        this.displayMode = displayResult.selectedDisplay as DisplayMode
      } else {
        this.displayMode = (flags.display || flags.mode) as DisplayMode
        this.environment = hasDevcontainer && isDockerRunning() ? 'devcontainer' : 'host'
      }

      // Prompt for execution settings (terminal, output mode, permissions, PR creation)
      const promptResult = await promptExecutionSettings(db, {
        displayMode: this.displayMode,
        environment: this.environment,
        permissionMode: flags['skip-permissions'] ? 'danger' as PermissionMode : undefined,
        createPR: flags['create-pr'] ? true : undefined,
        log: (msg) => this.log(styles.header(msg)),
        jsonMode: jsonMode ? { flags, commandName: 'work watch' } : undefined,
      })
      this.executionConfig = promptResult.executionConfig
      this.skipPermissions = promptResult.permissionMode === 'danger'
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
      const initialTickets = await this.storage.listTickets(this.projectId, { column: this.columnName })
      for (const ticket of initialTickets) {
        this.knownTickets.add(ticket.id)
      }
      this.log(styles.muted(`   Found ${initialTickets.length} existing tickets in column`))

      // If --once, just do a single spawn cycle
      if (flags.once) {
        this.log('')
        const result = await spawnForColumn(
          this.projectId,
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
        // eslint-disable-next-line no-await-in-loop -- Continuous polling loop
        await this.pollForNewTickets(
          flags,
          executionStorage,
          workspaceInfo,
          db
        )

        // Wait for interval
        // eslint-disable-next-line no-await-in-loop -- Poll interval delay
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
    const currentTickets = await this.storage.listTickets(this.projectId, { column: this.columnName })

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
      this.projectId,
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
