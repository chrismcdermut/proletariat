import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId, isContainerRunning, sanitizeContainerId } from '../../lib/docker/resolve.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class DockerStart extends Command {
  static description = 'Start a stopped container (by execution ID, agent name, or container ID)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> kalanick',
    '<%= config.bin %> <%= command.id %> abc123',
  ]

  static flags = {
    ...machineOutputFlags,
    attach: Flags.boolean({
      char: 'a',
      description: 'Attach to container after starting',
      default: false,
    }),
  }

  static args = {
    target: Args.string({
      description: 'Execution ID (WORK-XXX), agent name, or container ID',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DockerStart)
    const jsonMode = shouldOutputJson(flags)

    if (!isDockerRunning()) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt new" first.')
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

    try {
      const result = resolveContainerId(args.target, executionStorage)

      if (!result.containerId) {
        db.close()
        this.error(result.error || 'Could not find container')
      }

      // Check if container is already running
      if (isContainerRunning(result.containerId)) {
        if (jsonMode) {
          this.log(JSON.stringify({ type: 'success', result: { containerId: result.containerId, displayName: result.displayName, executionId: result.executionId, status: 'already_running' } }, null, 2))
          db.close()
          return
        }
        this.log(`\n${styles.warning(`Container ${result.displayName} is already running`)}\n`)
        db.close()
        return
      }

      if (!jsonMode) {
        this.log(`\n${styles.header('Start Container')}`)
        this.log(styles.muted(`Target: ${result.displayName}`))
        this.log(styles.muted(`Container: ${result.containerId.substring(0, 12)}\n`))
      }

      // Start container
      if (!jsonMode) {
        this.log(styles.muted('Starting container...'))
      }

      try {
        const attachFlag = flags.attach ? '-a' : ''
        const safeId = sanitizeContainerId(result.containerId)
        execSync(`docker start ${attachFlag} ${safeId}`, {
          stdio: flags.attach ? 'inherit' : ['pipe', 'pipe', 'pipe'],
        })

        // Update execution status if we have an execution ID
        if (result.executionId) {
          executionStorage.updateStatus(result.executionId, 'running')
        }

        if (jsonMode) {
          this.log(JSON.stringify({ type: 'success', result: { containerId: result.containerId, displayName: result.displayName, executionId: result.executionId, status: 'started' } }, null, 2))
          db.close()
          return
        }

        this.log(`${styles.success('Container started successfully')}\n`)
      } catch (error) {
        this.log(`${styles.error(`Failed to start container: ${error instanceof Error ? error.message : error}`)}\n`)
      }
      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
