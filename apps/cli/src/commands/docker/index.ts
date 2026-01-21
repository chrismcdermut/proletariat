import { Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { execSync } from 'child_process'
import * as path from 'path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Docker extends Command {
  static description = 'Manage Docker containers used by agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> docker status',
    '<%= config.bin %> docker list',
    '<%= config.bin %> docker logs WORK-001',
    '<%= config.bin %> docker start WORK-001',
    '<%= config.bin %> docker stop kalanick',
    '<%= config.bin %> docker shell WORK-001',
    '<%= config.bin %> docker restart abc123',
    '<%= config.bin %> docker sync',
    '<%= config.bin %> docker clean',
    '<%= config.bin %> docker prune',
  ]

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Docker)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Check Docker status', value: 'status' },
      { name: 'List containers', value: 'list' },
      { name: 'View container logs', value: 'logs' },
      { name: 'Start a container', value: 'start' },
      { name: 'Stop a container', value: 'stop' },
      { name: 'Shell into container', value: 'shell' },
      { name: 'Restart a container', value: 'restart' },
      { name: 'Sync containers from Docker', value: 'sync' },
      { name: 'Clean orphaned containers', value: 'clean' },
      { name: 'Prune unused resources', value: 'prune' },
      { name: 'Exit', value: 'exit' },
    ]
    const message = 'What would you like to do?'

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('docker', flags)
      )
      return
    }

    this.log('')
    this.log(styles.header('Docker Management'))
    this.log('')

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message,
        choices: [
          ...menuChoices.slice(0, 7),
          new inquirer.Separator(),
          ...menuChoices.slice(7, 10),
          new inquirer.Separator(),
          menuChoices[10],
        ],
      },
    ])

    if (action === 'exit') {
      return
    }

    // Commands that require a target
    const targetCommands = ['logs', 'start', 'stop', 'shell', 'restart']

    if (targetCommands.includes(action)) {
      const target = await this.selectContainer(action)
      if (!target) return

      await this.config.runCommand(`docker:${action}`, [target])
    } else {
      await this.config.runCommand(`docker:${action}`, [])
    }
  }

  private async selectContainer(action: string): Promise<string | null> {
    // Check Docker first
    const dockerRunning = isDockerRunning()
    if (!dockerRunning) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    // Get workspace info (optional - we can still show docker containers without it)
    let workspaceInfo
    let db: Database.Database | null = null
    let executionStorage: ExecutionStorage | null = null
    let containerStorage: ContainerStorage | null = null

    try {
      workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
      containerStorage = new ContainerStorage(db)
    } catch {
      // No workspace - that's ok, we'll just show docker containers
    }

    try {
      // Get raw docker container info (just IDs and status)
      const dockerContainers = this.getDockerContainers()

      // Sync containers to database (if we have a workspace)
      // This uses image name to determine agent for NEW containers only
      if (containerStorage && dockerContainers.length > 0) {
        const containersWithAgent = dockerContainers.map(c => ({
          ...c,
          agentName: this.extractAgentFromImage(c.image),
        }))
        containerStorage.syncFromDocker(containersWithAgent)
      }

      // Get tracked containers from DB (source of truth for agent names)
      const trackedContainers = containerStorage
        ? containerStorage.listContainers({ limit: 50 })
        : []

      // Get tracked executions with containers from DB
      const trackedExecutions = executionStorage
        ? executionStorage.listExecutions({ limit: 50 }).filter(e => e.environment === 'devcontainer' || e.containerId)
        : []

      // Track which docker IDs we've already added
      const addedDockerIds = new Set<string>()

      // Build choices
      const choices: Array<{ name: string; value: string } | inquirer.Separator> = []

      // Column header
      const header = styles.muted(`  ${'ID'.padEnd(14)} ${'Agent'.padEnd(15)} Status`)

      // Add active executions first (with container info from DB)
      const activeExecutions = trackedExecutions.filter(e => e.status === 'running' || e.status === 'starting')
      if (activeExecutions.length > 0) {
        choices.push(new inquirer.Separator('── Active Executions ──'))
        choices.push(new inquirer.Separator(header))
        for (const exec of activeExecutions) {
          // Get container from DB (source of truth)
          const container = trackedContainers.find(c => c.currentExecutionId === exec.id)
          const dockerContainer = exec.containerId
            ? dockerContainers.find(c => c.id.startsWith(exec.containerId!.substring(0, 12)))
            : null
          const isRunning = dockerContainer?.status.startsWith('Up') || container?.status === 'running'
          const statusIcon = isRunning ? styles.success('●') : styles.warning('◐')

          // Use agent name from execution record (DB source of truth)
          choices.push({
            name: `${statusIcon} ${exec.id.padEnd(14)} ${exec.agentName.padEnd(15)} ${styles.success(exec.status)}`,
            value: exec.id,
          })

          if (exec.containerId) {
            addedDockerIds.add(exec.containerId.substring(0, 12))
          }
        }
      }

      // Add containers from database (not tied to active executions)
      // Agent name comes from DB - the authoritative source
      const standbyContainers = trackedContainers.filter(c =>
        !activeExecutions.some(e => e.containerId?.startsWith(c.dockerId.substring(0, 12))) &&
        c.status !== 'removed'
      )
      if (standbyContainers.length > 0) {
        choices.push(new inquirer.Separator('── Containers ──'))
        if (activeExecutions.length === 0) {
          choices.push(new inquirer.Separator(header))
        }
        for (const container of standbyContainers) {
          const dockerStatus = dockerContainers.find(d => d.id.startsWith(container.dockerId.substring(0, 12)))
          const isRunning = dockerStatus?.status.startsWith('Up')
          const statusIcon = isRunning ? styles.success('●') : styles.muted('○')
          const statusText = isRunning ? styles.success('running') : styles.muted(container.status)

          // Agent name from DB (source of truth)
          choices.push({
            name: `${statusIcon} ${container.dockerId.substring(0, 12).padEnd(14)} ${container.agentName.padEnd(15)} ${statusText}`,
            value: container.dockerId,
          })

          addedDockerIds.add(container.dockerId.substring(0, 12))
        }
      }

      // Add devcontainers from Docker that aren't in DB yet
      // Fall back to parsing image name only for untracked containers
      const untracked = dockerContainers.filter(c => !addedDockerIds.has(c.id.substring(0, 12)))
      if (untracked.length > 0) {
        choices.push(new inquirer.Separator('── Untracked (run sync) ──'))
        for (const container of untracked) {
          const isRunning = container.status.startsWith('Up')
          const statusIcon = isRunning ? styles.success('●') : styles.muted('○')
          const statusText = isRunning ? styles.success('running') : styles.muted(container.status.toLowerCase())
          // Parse agent from image only for untracked containers
          const agentName = this.extractAgentFromImage(container.image)

          choices.push({
            name: `${statusIcon} ${container.id.substring(0, 12).padEnd(14)} ${agentName.padEnd(15)} ${statusText}`,
            value: container.id,
          })
        }
      }

      // Add separator and options
      choices.push(new inquirer.Separator())
      choices.push({ name: 'Enter container ID manually...', value: '__manual__' })
      choices.push({ name: styles.muted('Cancel'), value: '__cancel__' })

      if (db) db.close()

      if (choices.length <= 2) {
        // Only manual option, just ask for input
        const { target } = await inquirer.prompt([
          {
            type: 'input',
            name: 'target',
            message: 'No containers found. Enter container ID:',
            validate: (input: string) => input.trim().length > 0 || 'Target is required',
          },
        ])
        return target.trim()
      }

      const { target } = await inquirer.prompt([
        {
          type: 'list',
          name: 'target',
          message: `Select container to ${action}:`,
          choices,
          pageSize: 15,
        },
      ])

      if (target === '__cancel__') {
        return null
      }

      if (target === '__manual__') {
        const { manualTarget } = await inquirer.prompt([
          {
            type: 'input',
            name: 'manualTarget',
            message: 'Enter execution ID (WORK-XXX), agent name, or container ID:',
            validate: (input: string) => input.trim().length > 0 || 'Target is required',
          },
        ])
        return manualTarget.trim()
      }

      return target
    } catch (error) {
      if (db) db.close()
      throw error
    }
  }

  /**
   * Get raw container info from Docker (no agent name inference)
   */
  private getDockerContainers(): Array<{ id: string; name: string; image: string; status: string }> {
    try {
      const output = execSync('docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}"', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (!output) return []

      return output.split('\n').filter(Boolean).map(line => {
        const [id, name, image, status] = line.split('|')
        return { id, name, image, status }
      }).filter(c => c.image.startsWith('vsc-')) // Only devcontainers
    } catch {
      return []
    }
  }

  /**
   * Extract agent name from devcontainer image name.
   * Only used for NEW/untracked containers - DB is source of truth otherwise.
   */
  private extractAgentFromImage(image: string): string {
    const match = image.match(/^vsc-([^-]+)-/)
    return match ? match[1] : 'unknown'
  }
}
