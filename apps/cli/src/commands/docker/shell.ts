import { Args, Command, Flags } from '@oclif/core'
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { resolveContainerId, isContainerRunning } from '../../lib/docker/resolve.js'

export default class DockerShell extends Command {
  static description = 'Open a shell in a running container (by execution ID, agent name, or container ID)'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %> kalanick',
    '<%= config.bin %> <%= command.id %> abc123 --shell /bin/bash',
  ]

  static flags = {
    shell: Flags.string({
      char: 's',
      description: 'Shell to use',
      default: '/bin/sh',
    }),
    user: Flags.string({
      char: 'u',
      description: 'User to run as',
    }),
    workdir: Flags.string({
      char: 'w',
      description: 'Working directory inside the container',
    }),
  }

  static args = {
    target: Args.string({
      description: 'Execution ID (WORK-XXX), agent name, or container ID',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DockerShell)

    if (!isDockerRunning()) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
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

    try {
      const result = resolveContainerId(args.target, executionStorage)

      if (!result.containerId) {
        db.close()
        this.error(result.error || 'Could not find container')
      }

      // Check if container is running
      if (!isContainerRunning(result.containerId)) {
        db.close()
        this.error(`Container ${result.displayName} is not running. Start it first or use 'docker restart'.`)
      }

      this.log(`\n${styles.header(`Shell into ${result.displayName}`)}`)
      this.log(styles.muted(`Container: ${result.containerId.substring(0, 12)}`))
      this.log(styles.muted(`Shell: ${flags.shell}`))
      this.log('─'.repeat(50) + '\n')

      db.close()

      // Build docker exec command
      const dockerArgs = ['exec', '-it']

      if (flags.user) {
        dockerArgs.push('--user', flags.user)
      }

      if (flags.workdir) {
        dockerArgs.push('--workdir', flags.workdir)
      }

      dockerArgs.push(result.containerId, flags.shell)

      // Spawn interactive shell
      const proc = spawn('docker', dockerArgs, {
        stdio: 'inherit',
      })

      proc.on('error', (err) => {
        this.error(`Failed to open shell: ${err.message}`)
      })

      proc.on('exit', (code) => {
        this.log('')
        this.log(styles.muted(`Shell exited with code ${code}`))
      })
    } catch (error) {
      db.close()
      throw error
    }
  }
}
