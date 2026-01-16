import { Command, Flags } from '@oclif/core'
import { execSync } from 'child_process'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class DockerPrune extends Command {
  static description = 'Remove unused Docker resources (containers, images, volumes, networks)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --volumes',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      aliases: ['yes', 'y'],
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be removed without removing',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all unused images, not just dangling ones',
      default: false,
    }),
    volumes: Flags.boolean({
      description: 'Also prune volumes (dangerous - data loss possible)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DockerPrune)

    if (!isDockerRunning()) {
      this.error('Docker is not running. Start Docker Desktop or the Docker daemon first.')
    }

    this.log(`\n${styles.header('Docker Prune')}`)
    this.log('─'.repeat(60))

    // Get current disk usage
    this.log(styles.subheader('\nCurrent Docker disk usage:'))
    try {
      const dfOutput = execSync('docker system df', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(dfOutput))
    } catch {
      this.log(styles.muted('Could not get disk usage info'))
    }

    // Show what will be pruned
    this.log(styles.subheader('Will remove:'))
    this.log(styles.muted('  • Stopped containers'))
    this.log(styles.muted('  • Unused networks'))
    if (flags.all) {
      this.log(styles.muted('  • All unused images (not just dangling)'))
    } else {
      this.log(styles.muted('  • Dangling images'))
    }
    this.log(styles.muted('  • Build cache'))
    if (flags.volumes) {
      this.log(styles.warning('  • Unused volumes (DATA LOSS POSSIBLE)'))
    }

    if (flags['dry-run']) {
      this.log(`\n${styles.warning('[DRY RUN] Would prune the above resources')}\n`)

      // Show what would be removed
      this.showPrunePreview(flags.all, flags.volumes)
      return
    }

    // Confirm
    if (!flags.force) {
      // Check if JSON output mode is active
      const jsonMode = shouldOutputJson(flags)

      // Build choices once, use for both JSON and interactive modes
      const confirmChoices = [
        { name: 'No', value: 'false' },
        { name: 'Yes', value: 'true' },
      ]
      const confirmMessage = flags.volumes
        ? 'This will remove unused resources INCLUDING VOLUMES. Data may be lost. Continue?'
        : 'Remove unused Docker resources?'

      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
          createMetadata('docker prune', flags)
        )
        return
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: confirmMessage,
          default: false,
        },
      ])

      if (!confirm) {
        this.log(`${styles.muted('Aborted.')}\n`)
        return
      }
    }

    // Run prune
    this.log(`\n${styles.muted('Pruning Docker resources...')}\n`)

    try {
      // Prune containers
      this.log(styles.muted('Removing stopped containers...'))
      const containerResult = execSync('docker container prune -f', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(containerResult.trim()))

      // Prune networks
      this.log(styles.muted('\nRemoving unused networks...'))
      const networkResult = execSync('docker network prune -f', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(networkResult.trim()))

      // Prune images
      this.log(styles.muted('\nRemoving unused images...'))
      const imageCmd = flags.all ? 'docker image prune -af' : 'docker image prune -f'
      const imageResult = execSync(imageCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(imageResult.trim()))

      // Prune build cache
      this.log(styles.muted('\nRemoving build cache...'))
      const buildResult = execSync('docker builder prune -f', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(buildResult.trim()))

      // Prune volumes if requested
      if (flags.volumes) {
        this.log(styles.warning('\nRemoving unused volumes...'))
        const volumeResult = execSync('docker volume prune -f', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.log(styles.muted(volumeResult.trim()))
      }

      this.log(`\n${styles.success('Docker prune completed')}`)

      // Show new disk usage
      this.log(styles.subheader('\nNew Docker disk usage:'))
      const newDfOutput = execSync('docker system df', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.log(styles.muted(newDfOutput))
    } catch (error) {
      this.log(styles.error(`Prune failed: ${error instanceof Error ? error.message : error}`))
    }
  }

  private showPrunePreview(includeAllImages: boolean, includeVolumes: boolean): void {
    this.log(styles.subheader('Preview of resources to remove:'))
    this.log('')

    // Stopped containers
    try {
      const containers = execSync('docker ps -aq --filter "status=exited" --filter "status=created"', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      const containerCount = containers ? containers.split('\n').length : 0
      this.log(styles.muted(`Containers: ${containerCount} stopped container(s)`))
    } catch {
      this.log(styles.muted('Containers: Unable to check'))
    }

    // Dangling images
    try {
      const imageCmd = includeAllImages
        ? 'docker images -q --filter "dangling=false" | wc -l'
        : 'docker images -q --filter "dangling=true" | wc -l'

      const imageCount = execSync(imageCmd, {
        encoding: 'utf-8',
        shell: '/bin/sh',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      const label = includeAllImages ? 'unused image(s)' : 'dangling image(s)'
      this.log(styles.muted(`Images: ${imageCount} ${label}`))
    } catch {
      this.log(styles.muted('Images: Unable to check'))
    }

    // Volumes
    if (includeVolumes) {
      try {
        const volumes = execSync('docker volume ls -q --filter "dangling=true"', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()

        const volumeCount = volumes ? volumes.split('\n').length : 0
        this.log(styles.warning(`Volumes: ${volumeCount} unused volume(s)`))
      } catch {
        this.log(styles.muted('Volumes: Unable to check'))
      }
    }

    this.log('')
  }
}
