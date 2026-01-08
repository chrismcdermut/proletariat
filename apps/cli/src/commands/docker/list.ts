import { Command, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import * as path from 'path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  agentDir: string | null
  uptime: string
}

export default class DockerList extends Command {
  static description = 'Show Docker containers from agent_work table with status'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --running',
  ]

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Show all containers (including non-devcontainer)',
      default: false,
    }),
    running: Flags.boolean({
      char: 'r',
      description: 'Only show running containers',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DockerList)

    // Check Docker status first
    if (!isDockerRunning()) {
      this.log(`\n${styles.error('Docker is not running')}`)
      this.log(`${styles.muted('Start Docker Desktop or the Docker daemon first.')}\n`)
      return
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
    let db: Database.Database
    try {
      db = new Database(dbPath)
    } catch {
      this.error('Could not open workspace database.')
    }

    const executionStorage = new ExecutionStorage(db)
    const containerStorage = new ContainerStorage(db)

    try {
      // Get containers tracked in agent_work (executions)
      const trackedExecutions = this.getTrackedContainers(executionStorage)

      // Get containers from containers table (source of truth for agent names)
      const dbContainers = containerStorage.listContainers({ limit: 50 })

      // Get running docker containers
      const runningContainers = this.getDockerContainers(workspaceInfo.agentsPath, flags.all)

      this.log(`\n${styles.header('Docker Containers')}`)
      this.log('='.repeat(100))

      // Display active executions from database
      const activeExecutions = trackedExecutions.filter(e => e.status === 'running' || e.status === 'starting')
      if (activeExecutions.length > 0) {
        this.log(styles.subheader('\nActive Executions:'))
        this.log(styles.muted(
          padEnd('ID', 15) +
          padEnd('Agent', 15) +
          padEnd('Ticket', 12) +
          padEnd('Status', 12) +
          'Container'
        ))
        this.log('-'.repeat(80))

        for (const exec of activeExecutions) {
          const statusColor = getStatusColor(exec.status)
          const containerId = exec.containerId ? exec.containerId.substring(0, 12) : styles.muted('none')

          // Check if container is actually running in Docker
          let containerStatus = ''
          if (exec.containerId) {
            const isRunning = runningContainers.some(c => c.id.startsWith(exec.containerId!.substring(0, 12)))
            containerStatus = isRunning ? styles.success(' (up)') : styles.warning(' (down)')
          }

          this.log(
            padEnd(exec.id, 15) +
            padEnd(exec.agentName, 15) +
            padEnd(exec.ticketId, 12) +
            statusColor(padEnd(exec.status, 12)) +
            containerId + containerStatus
          )
        }
      }

      // Display containers from DB (with agent names - source of truth)
      const filteredContainers = flags.running
        ? runningContainers.filter(c => c.status.includes('Up'))
        : runningContainers

      if (filteredContainers.length > 0) {
        this.log(styles.subheader('\nDocker Containers' + (flags.all ? ' (all)' : ' (devcontainers)') + ':'))
        this.log(styles.muted(
          padEnd('Container ID', 15) +
          padEnd('Agent', 15) +
          padEnd('Status', 15) +
          'Uptime'
        ))
        this.log('-'.repeat(70))

        for (const container of filteredContainers) {
          const statusColor = container.status.includes('Up') ? styles.success : styles.muted

          // Look up agent name from DB (source of truth)
          const dbContainer = dbContainers.find(c => c.dockerId.startsWith(container.id.substring(0, 12)))
          const agentName = dbContainer?.agentName || this.extractAgentFromImage(container.image) || container.name

          this.log(
            padEnd(container.id, 15) +
            padEnd(agentName, 15) +
            statusColor(padEnd(container.status, 15)) +
            styles.muted(container.uptime)
          )
        }
      } else if (!flags.running) {
        this.log(styles.muted('\nNo devcontainer Docker containers found.'))
      } else {
        this.log(styles.muted('\nNo running containers found.'))
      }

      this.log(`\n${styles.muted('Commands:')}`)
      this.log(styles.muted('  prlt docker status    Check Docker daemon status'))
      this.log(`${styles.muted('  prlt docker clean     Remove orphaned containers')}\n`)

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  private getTrackedContainers(executionStorage: ExecutionStorage) {
    // Get executions that used devcontainer environment
    const executions = executionStorage.listExecutions({ limit: 50 })
    return executions.filter(e =>
      e.environment === 'devcontainer' ||
      e.containerId
    )
  }

  private getDockerContainers(agentsPath: string, showAll: boolean): ContainerInfo[] {
    try {
      // Get containers - filter by devcontainer label unless --all
      let cmd = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Label \\"devcontainer.local_folder\\"}}"'

      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (!output) return []

      const containers: ContainerInfo[] = []
      const lines = output.split('\n')

      for (const line of lines) {
        const [id, name, image, status, agentDir] = line.split('|')

        // Filter to devcontainers unless --all
        if (!showAll && !agentDir) continue

        // Extract uptime from status
        const uptimeMatch = status.match(/Up (.+)/)
        const uptime = uptimeMatch ? uptimeMatch[1] : '-'

        containers.push({
          id,
          name,
          image,
          status: status.split(' ').slice(0, 2).join(' '),
          agentDir: agentDir || null,
          uptime,
        })
      }

      return containers
    } catch {
      return []
    }
  }

  /**
   * Extract agent name from devcontainer image name (fallback only)
   */
  private extractAgentFromImage(image: string): string | null {
    const match = image.match(/^vsc-([^-]+)-/)
    return match ? match[1] : null
  }
}

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 2) + '..'
}

function getStatusColor(status: string): (s: string) => string {
  switch (status) {
    case 'running':
      return styles.success
    case 'starting':
      return styles.warning
    case 'completed':
      return styles.muted
    case 'failed':
      return styles.error
    case 'stopped':
      return styles.muted
    default:
      return (s: string) => s
  }
}
