import { Command } from '@oclif/core'
import { execSync } from 'child_process'
import { styles } from '../../lib/styles.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

export default class DockerStatus extends Command {
  static description = 'Check if Docker daemon is running'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {}

  async run(): Promise<void> {
    this.log(`\n${styles.header('Docker Status')}`)
    this.log('─'.repeat(50))

    const running = isDockerRunning()

    if (running) {
      this.log(`${styles.success('Running')} Docker daemon is available`)

      // Get more details
      try {
        const version = execSync('docker version --format "{{.Server.Version}}"', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()

        const info = execSync('docker info --format "{{.Containers}} containers ({{.ContainersRunning}} running)"', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()

        this.log(`\n${styles.muted(`  Version: ${version}`)}`)
        this.log(styles.muted(`  ${info}\n`))
      } catch {
        // Ignore errors getting additional info
        this.log('')
      }
    } else {
      this.log(`${styles.error('Not Running')} Docker daemon is not available\n`)
      this.log(`${styles.muted('Start Docker Desktop or the Docker daemon to use devcontainer features.')}\n`)
    }
  }
}
