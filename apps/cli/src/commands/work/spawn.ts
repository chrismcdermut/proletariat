import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { getPMOContext } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import {
  spawnForColumn,
  isDockerRunning,
  AgentStrategy,
} from '../../lib/execution/spawner.js'
import { DisplayMode, ExecutionEnvironment } from '../../lib/execution/types.js'
import { promptExecutionSettings } from '../../lib/execution/config.js'

export default class WorkSpawn extends Command {
  static description = 'Spawn agents for all tickets in a column'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --column Ready',
    '<%= config.bin %> <%= command.id %> --column Ready --strategy round-robin',
    '<%= config.bin %> <%= command.id %> --column Ready --agent dorsey',
    '<%= config.bin %> <%= command.id %> --column Ready --limit 3',
    '<%= config.bin %> <%= command.id %> --column Ready --dry-run',
  ]

  static flags = {
    column: Flags.string({
      char: 'c',
      description: 'Column to spawn tickets from (prompts if not provided)',
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
      description: 'Maximum number of tickets to spawn',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be spawned without executing',
      default: false,
    }),
    mode: Flags.string({
      char: 'm',
      description: 'Display mode for agent output',
      options: ['terminal', 'foreground', 'background', 'tmux'],
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output mode: interactive (streaming) or print (final only)',
      options: ['interactive', 'print'],
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

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkSpawn)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch (error) {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    if (workspaceInfo.agents.length === 0) {
      this.error('No agents found in workspace. Add agents first with "prlt agents add".')
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
      // Get board columns for selection
      const board = await storage.getBoard()
      const columns = board.columns.map(col => col.name)

      if (columns.length === 0) {
        await storage.close()
        db.close()
        this.error('No columns found in board. Initialize board first.')
      }

      // Prompt for column if not provided
      let columnName = flags.column
      if (!columnName) {
        const { selectedColumn } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedColumn',
            message: 'Select column to spawn agents from:',
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
        columnName = selectedColumn
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
      let environment: ExecutionEnvironment = 'host'
      let displayMode: DisplayMode = 'background'

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
          environment = selectedEnvironment
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
        displayMode = selectedDisplay as DisplayMode
      } else {
        displayMode = flags.mode as DisplayMode
        environment = hasDevcontainer && dockerRunning ? 'devcontainer' : 'host'
      }

      // Prompt for execution settings (terminal, output mode, permissions, PR creation)
      const { executionConfig, skipPermissions, createPR } = await promptExecutionSettings(db, {
        displayMode,
        environment,
        outputMode: flags.output as 'interactive' | 'print' | undefined,
        skipPermissions: flags['skip-permissions'] ? true : undefined,
        createPR: flags['create-pr'] ? true : undefined,
        log: (msg) => this.log(styles.header(msg)),
      })

      this.log('')
      if (flags['dry-run']) {
        this.log(styles.header(`🧪 Dry Run: Spawning agents for column "${columnName}"`))
      } else {
        this.log(styles.header(`🚀 Spawning agents for column "${columnName}"`))
      }
      this.log('')

      this.log(styles.muted(`   Strategy: ${flags.strategy}`))
      this.log(styles.muted(`   Environment: ${environment}`))
      this.log(styles.muted(`   Display: ${displayMode}`))
      if (displayMode === 'terminal') {
        this.log(styles.muted(`   Terminal: ${executionConfig.terminal.app}`))
      }
      this.log(styles.muted(`   Output: ${executionConfig.outputMode === 'interactive' ? 'streaming (watch Claude work)' : 'print (final result only)'}`))
      if (skipPermissions) {
        this.log(styles.warning(`   Permissions: ⚠️  danger (--dangerously-skip-permissions)`))
      } else {
        this.log(styles.success(`   Permissions: 🔒 safe`))
      }
      if (createPR) {
        this.log(styles.muted(`   Create PR: yes (when work is ready)`))
      }
      if (flags.agent) {
        this.log(styles.muted(`   Agent: ${flags.agent}`))
      }
      if (flags.limit) {
        this.log(styles.muted(`   Limit: ${flags.limit}`))
      }
      this.log('')

      const result = await spawnForColumn(
        columnName!,
        storage,
        executionStorage,
        workspaceInfo,
        db,
        pmoPath,
        {
          strategy: flags.strategy as AgentStrategy,
          specificAgent: flags.agent,
          limit: flags.limit,
          dryRun: flags['dry-run'],
          skipPermissions,
          createPR,
          environment,
          displayMode,
          executionConfig,
          log: (msg) => this.log(styles.muted(`   ${msg}`)),
        }
      )

      // Print summary
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

      if (!flags['dry-run'] && result.spawned.length > 0) {
        this.log(styles.muted('Commands:'))
        this.log(styles.muted('  prlt execution list           View running executions'))
        this.log('')
      }

      await storage.close()
      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
