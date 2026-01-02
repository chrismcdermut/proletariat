import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import Database from 'better-sqlite3'
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

export default class WorkSpawnAll extends Command {
  static description = 'Spawn work on all backlog tickets (alias for "work spawn" with backlog column)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --skip-permissions',
    '<%= config.bin %> <%= command.id %> --create-pr',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if work already in progress',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be spawned without actually starting agents',
      default: false,
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
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
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    strategy: Flags.string({
      char: 's',
      description: 'Agent selection strategy',
      options: ['round-robin', 'least-busy', 'random'],
      default: 'round-robin',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of tickets to spawn',
    }),
    mode: Flags.string({
      char: 'm',
      description: 'Display mode for agent output',
      options: ['terminal', 'foreground', 'background', 'tmux'],
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkSpawnAll)

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
      // Get board and find backlog column
      const board = await storage.getBoard()
      const columns = board.columns.map(col => col.name)

      // Find the backlog column (usually first column or named "Backlog")
      let backlogColumn = columns.find(c => c.toLowerCase() === 'backlog')
      if (!backlogColumn) {
        // Fall back to first column
        backlogColumn = columns[0]
      }

      if (!backlogColumn) {
        await storage.close()
        db.close()
        this.error('No columns found in board. Initialize board first.')
      }

      // Check if any agent has devcontainer
      const hasDevcontainer = workspaceInfo.agents.some(agent => {
        const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
        return hasDevcontainerConfig(agentDir)
      })

      // Docker check
      const dockerRunning = isDockerRunning()
      if (hasDevcontainer && !dockerRunning && !flags['run-on-host']) {
        this.warn(
          'Docker is not running. Agents will run on host instead of devcontainer.\n' +
          'Start Docker Desktop for sandboxed execution.'
        )
      }

      // Determine environment and display mode
      let environment: ExecutionEnvironment = 'host'
      let displayMode: DisplayMode = flags.mode as DisplayMode || 'background'

      if (hasDevcontainer && dockerRunning && !flags['run-on-host']) {
        environment = 'devcontainer'
      }

      // Get execution settings (terminal, output mode, permissions, PR creation)
      const { executionConfig, skipPermissions, createPR } = await promptExecutionSettings(db, {
        displayMode,
        environment,
        skipPermissions: flags['skip-permissions'] ? true : undefined,
        createPR: flags['create-pr'] ? true : undefined,
        log: (msg) => this.log(styles.header(msg)),
      })

      this.log('')
      if (flags['dry-run']) {
        this.log(styles.header(`🧪 Dry Run: Spawning agents for all backlog tickets`))
      } else {
        this.log(styles.header(`🚀 Spawning agents for all backlog tickets`))
      }
      this.log('')

      this.log(styles.muted(`   Column: ${backlogColumn}`))
      this.log(styles.muted(`   Strategy: ${flags.strategy}`))
      this.log(styles.muted(`   Environment: ${environment}`))
      this.log(styles.muted(`   Display: ${displayMode}`))
      if (skipPermissions) {
        this.log(styles.warning(`   Permissions: ⚠️  danger (--dangerously-skip-permissions)`))
      } else {
        this.log(styles.success(`   Permissions: 🔒 safe`))
      }
      if (createPR) {
        this.log(styles.muted(`   Create PR: yes (when work is ready)`))
      }
      if (flags.limit) {
        this.log(styles.muted(`   Limit: ${flags.limit}`))
      }
      this.log('')

      const result = await spawnForColumn(
        backlogColumn,
        storage,
        executionStorage,
        workspaceInfo,
        db,
        pmoPath,
        {
          strategy: flags.strategy as AgentStrategy,
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
        const verb = flags['dry-run'] ? 'Would spawn' : 'Spawned'
        this.log(styles.success(`   ✓ ${verb}: ${result.spawned.length}`))
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
