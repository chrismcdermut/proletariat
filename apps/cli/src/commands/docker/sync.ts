import { Command } from '@oclif/core'
import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ContainerStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { visualPadEnd } from '../../lib/string-utils.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'

export default class DockerSync extends Command {
  static description = 'Sync container status from Docker into the database'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DockerSync)
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
    let db: Database.Database
    try {
      db = openWorkspaceDatabase(workspaceInfo.path)
    } catch {
      this.error('Could not open workspace database.')
    }

    try {
      const containerStorage = new ContainerStorage(db)

      // Get devcontainers from Docker
      const dockerContainers = this.getDockerContainers()

      if (!jsonMode) {
        this.log(`\n${styles.header('Syncing Containers')}`)
        this.log(styles.muted(`Found ${dockerContainers.length} devcontainers in Docker\n`))
      }

      // Add agent name from image (only used for new containers)
      const containersWithAgent = dockerContainers.map(c => ({
        ...c,
        agentName: this.extractAgentFromImage(c.image),
      }))

      // Sync with database
      const result = containerStorage.syncFromDocker(containersWithAgent)

      if (jsonMode) {
        const containers = containerStorage.listContainers({ limit: 20 })
        this.log(JSON.stringify({
          type: 'success',
          result: {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            containers: containers.map(c => ({
              id: c.id,
              agentName: c.agentName,
              status: c.status,
              dockerId: c.dockerId,
            })),
          },
        }, null, 2))
        db.close()
        return
      }

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
          visualPadEnd('ID', 18) +
          visualPadEnd('Agent', 15) +
          visualPadEnd('Status', 12) +
          'Docker ID'
        ))
        this.log(styles.muted('  ' + '-'.repeat(65)))

        for (const container of containers) {
          const statusColor = container.status === 'running' ? styles.success :
                             container.status === 'exited' ? styles.muted :
                             container.status === 'removed' ? styles.error : styles.warning
          this.log(
            '  ' +
            visualPadEnd(container.id, 18) +
            visualPadEnd(container.agentName, 15) +
            statusColor(visualPadEnd(container.status, 12)) +
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
