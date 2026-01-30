import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { colors } from '../../lib/colors.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  isDockerRunning,
  getPrltVersion,
  getBaseImageTag,
  buildBaseImage,
} from '../../lib/execution/runners.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

/**
 * Check if a Docker image exists locally.
 */
function imageExists(imageName: string): boolean {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export default class AgentBuildBase extends PMOCommand {
  static description = 'Build the shared base Docker image for all agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --no-cache',
    '<%= config.bin %> <%= command.id %> --force  # Rebuild even if exists',
    '<%= config.bin %> <%= command.id %> --json  # JSON mode for AI agents',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build without using cache',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force rebuild even if image already exists',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(AgentBuildBase)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Check Docker is running
    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson(
          'DOCKER_NOT_RUNNING',
          'Docker is not running. Please start Docker Desktop and try again.',
          createMetadata('agent build-base', flags)
        )
        this.exit(1)
      }
      this.error('Docker is not running. Please start Docker Desktop and try again.')
    }

    const prltVersion = getPrltVersion()
    const baseImageTag = getBaseImageTag()

    // Check if image already exists
    if (imageExists(baseImageTag) && !flags.force) {
      if (jsonMode) {
        outputSuccessAsJson(
          { imageTag: baseImageTag, version: prltVersion, status: 'exists' },
          createMetadata('agent build-base', flags)
        )
        return
      }
      this.log(colors.success(`✓ Base image already exists: ${baseImageTag}`))
      this.log(colors.textMuted('Use --force to rebuild'))
      return
    }

    // Find an agent with a Dockerfile to use as template
    const workspaceInfo = getWorkspaceInfo()
    if (!workspaceInfo) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_WORKSPACE',
          'Not in a proletariat workspace. Run `prlt init` first.',
          createMetadata('agent build-base', flags)
        )
        this.exit(1)
      }
      this.error('Not in a proletariat workspace. Run `prlt init` first.')
    }

    const agentDir = this.findAgentWithDockerfile(workspaceInfo.path)
    if (!agentDir) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_DOCKERFILE',
          'No agent with Dockerfile found. Add an agent first: prlt agent staff add',
          createMetadata('agent build-base', flags)
        )
        this.exit(1)
      }
      this.error('No agent with Dockerfile found. Add an agent first: prlt agent staff add')
    }

    this.log(colors.primary(`🔨 Building base image: ${baseImageTag}\n`))
    this.log(colors.textSecondary(`  Version: ${prltVersion}`))
    this.log(colors.textSecondary(`  Using Dockerfile from: ${path.relative(workspaceInfo.path, agentDir)}`))
    this.log('')

    // Build the base image
    const buildArgs: Record<string, string> = {
      TZ: 'America/Los_Angeles',
      PRLT_REGISTRY: 'npm',
      PRLT_VERSION: 'latest',
    }

    // Add --no-cache if requested
    if (flags['no-cache']) {
      this.log(colors.textMuted('  Building without cache...\n'))
    }

    try {
      const success = buildBaseImage(agentDir, baseImageTag, buildArgs)

      if (!success) {
        if (jsonMode) {
          outputErrorAsJson(
            'BUILD_FAILED',
            'Failed to build base image',
            createMetadata('agent build-base', flags)
          )
          this.exit(1)
        }
        this.error('Failed to build base image. Check Docker logs for details.')
      }

      if (jsonMode) {
        outputSuccessAsJson(
          { imageTag: baseImageTag, version: prltVersion, status: 'built' },
          createMetadata('agent build-base', flags)
        )
        return
      }

      this.log('')
      this.log(colors.success(`✓ Base image built successfully: ${baseImageTag}`))
      this.log(colors.textMuted('All agent spawns will now use this shared image'))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson(
          'BUILD_FAILED',
          `Failed to build base image: ${error instanceof Error ? error.message : String(error)}`,
          createMetadata('agent build-base', flags)
        )
        this.exit(1)
      }
      this.error(`Failed to build base image: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Find an agent directory that has a Dockerfile.
   * Looks in both staff and temp agent directories.
   */
  private findAgentWithDockerfile(workspacePath: string): string | null {
    const agentsPath = path.join(workspacePath, 'agents')

    // Check staff agents first
    const staffPath = path.join(agentsPath, 'staff')
    if (fs.existsSync(staffPath)) {
      const staffDirs = fs.readdirSync(staffPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))

      for (const dir of staffDirs) {
        const dockerfilePath = path.join(staffPath, dir.name, '.devcontainer', 'Dockerfile')
        if (fs.existsSync(dockerfilePath)) {
          return path.join(staffPath, dir.name)
        }
      }
    }

    // Check temp agents
    const tempPath = path.join(agentsPath, 'temp')
    if (fs.existsSync(tempPath)) {
      const tempDirs = fs.readdirSync(tempPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))

      for (const dir of tempDirs) {
        const dockerfilePath = path.join(tempPath, dir.name, '.devcontainer', 'Dockerfile')
        if (fs.existsSync(dockerfilePath)) {
          return path.join(tempPath, dir.name)
        }
      }
    }

    return null
  }
}
