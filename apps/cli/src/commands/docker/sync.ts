import { Command } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ContainerStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

export default class DockerSync extends Command {
  static description = 'Sync container status from Docker into the database'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  async run(): Promise<void> {
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

    try {
      const containerStorage = new ContainerStorage(db)

      // Get devcontainers from Docker
      const dockerContainers = this.getDockerContainers()

      this.log(`\n${styles.header('Syncing Containers')}`)
      this.log(styles.muted(`Found ${dockerContainers.length} devcontainers in Docker\n`))

      // Add agent name from image (only used for new containers)
      const containersWithAgent = dockerContainers.map(c => ({
        ...c,
        agentName: this.extractAgentFromImage(c.image),
      }))

      // Sync with database
      const result = containerStorage.syncFromDocker(containersWithAgent)

      this.log(styles.success('✓ Sync complete'))
      this.log(styles.muted(`  Added: ${result.added}`))
      this.log(styles.muted(`  Updated: ${result.updated}`))
      this.log(styles.muted(`  Marked removed: ${result.removed}\n`))

      // Show current containers
      const containers = containerStorage.listContainers({ limit: 20 })
      if (containers.length > 0) {
        this.log(styles.subheader('Tracked Containers:'))
        this.log(styles.muted(
          '  ' +
          'ID'.padEnd(18) +
          'Agent'.padEnd(15) +
          'Status'.padEnd(12) +
          'Docker ID'
        ))
        this.log(styles.muted('  ' + '-'.repeat(65)))

        for (const container of containers) {
          const statusColor = container.status === 'running' ? styles.success :
                             container.status === 'exited' ? styles.muted :
                             container.status === 'removed' ? styles.error : styles.warning
          this.log(
            '  ' +
            container.id.padEnd(18) +
            container.agentName.padEnd(15) +
            statusColor(container.status.padEnd(12)) +
            styles.muted(container.dockerId.substring(0, 12))
          )
        }
        this.log('')
      } else {
        this.log('')
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Get raw container info from Docker
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
   * Only used for initial sync - DB is source of truth after that.
   */
  private extractAgentFromImage(image: string): string {
    const match = image.match(/^vsc-([^-]+)-/)
    return match ? match[1] : 'unknown'
  }
}
