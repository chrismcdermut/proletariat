import { Command, Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import {
  PNPM_STORE_CACHE_VOLUME,
  pnpmStoreCacheExists,
  removePnpmStoreCache,
  buildPnpmStoreCache,
} from '../../lib/execution/runners/docker-management.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/base-command.js'
import { execSync } from 'node:child_process'

export default class DockerRebuildCache extends Command {
  static description = 'Rebuild the shared pnpm store cache volume for fast agent installs'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Delete and rebuild the cache even if it already exists',
      default: false,
    }),
    'delete-only': Flags.boolean({
      description: 'Only delete the cache volume (next agent spawn rebuilds it)',
      default: false,
    }),
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DockerRebuildCache)
    const jsonMode = shouldOutputJson(flags)

    if (!isDockerRunning()) {
      if (jsonMode) {
        this.log(JSON.stringify({ success: false, error: 'Docker is not running' }))
      } else {
        this.log(`\n${styles.error('Docker is not running')}`)
        this.log(`${styles.muted('Start Docker Desktop or the Docker daemon first.')}\n`)
      }
      return
    }

    const cacheExists = pnpmStoreCacheExists()

    if (cacheExists && !flags.force && !flags['delete-only']) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: true,
          action: 'none',
          message: `Cache volume ${PNPM_STORE_CACHE_VOLUME} already exists. Use --force to rebuild.`,
        }))
      } else {
        this.log(`\n${styles.success('Cache exists')} Volume ${styles.code(PNPM_STORE_CACHE_VOLUME)} is already present.`)
        this.log(`${styles.muted('Use --force to delete and rebuild, or --delete-only to just remove it.')}\n`)
      }
      return
    }

    // Step 1: Remove existing cache
    if (cacheExists) {
      if (!jsonMode) {
        this.log(`\nRemoving existing cache volume ${styles.code(PNPM_STORE_CACHE_VOLUME)}...`)
      }
      const removed = removePnpmStoreCache()
      if (!removed) {
        if (jsonMode) {
          this.log(JSON.stringify({
            success: false,
            error: `Failed to remove cache volume. It may be in use by a running container.`,
          }))
        } else {
          this.log(`${styles.error('Failed to remove cache volume.')} It may be in use by a running container.`)
          this.log(`${styles.muted('Stop containers using this volume first: prlt docker stop --all')}\n`)
        }
        return
      }
      if (!jsonMode) {
        this.log(`${styles.success('Removed')} cache volume deleted`)
      }
    }

    if (flags['delete-only']) {
      if (jsonMode) {
        this.log(JSON.stringify({ success: true, action: 'deleted' }))
      } else {
        this.log(`\n${styles.success('Done')} Cache volume removed. Next agent spawn will rebuild it automatically.\n`)
      }
      return
    }

    // Step 2: Find an agent image to use for building the cache
    let imageName: string | null = null
    try {
      const images = execSync(
        'docker images --filter "reference=prlt-agent-*" --format "{{.Repository}}:{{.Tag}}" | head -1',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim()
      if (images) {
        imageName = images
      }
    } catch {
      // No existing agent images
    }

    if (!imageName) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: false,
          error: 'No agent Docker image found. Spawn an agent first to build the base image.',
        }))
      } else {
        this.log(`\n${styles.error('No agent image found.')}`)
        this.log(`${styles.muted('Spawn an agent first (prlt work start) to build the base Docker image.')}\n`)
      }
      return
    }

    // Step 3: Find a workspace with lockfiles
    let agentDir: string | null = null
    try {
      // Look for the most recently used agent directory
      const containers = execSync(
        'docker ps -a --filter "name=prlt-agent-" --format "{{.Mounts}}" | head -1',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim()
      // Fall back to current working directory
      if (!containers) {
        agentDir = process.cwd()
      }
    } catch {
      // Ignore
    }

    if (!agentDir) {
      agentDir = process.cwd()
    }

    if (!jsonMode) {
      this.log(`\nBuilding pnpm store cache using image ${styles.code(imageName)}...`)
      this.log(`${styles.muted('This may take a few minutes on first run.')}`)
    }

    const success = buildPnpmStoreCache(agentDir, imageName)

    if (jsonMode) {
      this.log(JSON.stringify({ success, action: success ? 'rebuilt' : 'failed', image: imageName }))
    } else if (success) {
      this.log(`\n${styles.success('Cache rebuilt')} Volume ${styles.code(PNPM_STORE_CACHE_VOLUME)} is ready.`)
      this.log(`${styles.muted('Agent containers will now mount this cache for fast pnpm installs.')}\n`)
    } else {
      this.log(`\n${styles.error('Cache build failed.')}`)
      this.log(`${styles.muted('Check Docker logs for details. The next agent spawn will try again automatically.')}\n`)
    }
  }
}
