import { Args, Command, Flags } from '@oclif/core'
import { execSync, spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { hasDevcontainerConfig, createDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import { getPrltChannel } from '../../lib/workspace-config.js'

export default class DockerRebuild extends Command {
  static description = 'Rebuild devcontainer image(s) for agent(s)'

  static examples = [
    '<%= config.bin %> <%= command.id %> altman                   # Rebuild single agent',
    '<%= config.bin %> <%= command.id %> --all                    # Rebuild all agents',
    '<%= config.bin %> <%= command.id %> --all -y                 # Rebuild all without confirmation',
    '<%= config.bin %> <%= command.id %> --regenerate             # Regenerate config files first',
    '<%= config.bin %> <%= command.id %> --prlt-channel npm:dev   # Use public npm @dev',
    '<%= config.bin %> <%= command.id %> --prlt-channel gh        # Use GitHub Packages',
    '<%= config.bin %> <%= command.id %> --prlt-channel mount     # Use local mounted prlt',
  ]

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Rebuild all agent containers',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      aliases: ['yes', 'y'],
      description: 'Skip confirmation prompt',
      default: false,
    }),
    cache: Flags.boolean({
      description: 'Use Docker layer cache (faster but may use stale layers)',
      default: false,
    }),
    parallel: Flags.boolean({
      char: 'p',
      description: 'Rebuild containers in parallel (faster but uses more resources)',
      default: false,
    }),
    'prlt-channel': Flags.string({
      description: 'prlt channel: npm, npm:dev, npm:x.y.z, gh, gh:dev, or mount',
      helpValue: 'CHANNEL',
    }),
    'regenerate': Flags.boolean({
      description: 'Regenerate devcontainer config files before rebuilding',
      default: false,
    }),
  }

  static args = {
    agent: Args.string({
      description: 'Agent name to rebuild (or use --all)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DockerRebuild)

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

    // Determine which agents to rebuild
    let agentsToRebuild: Array<{ name: string; path: string }> = []

    if (flags.all) {
      // Rebuild all agents with devcontainer configs
      agentsToRebuild = workspaceInfo.agents
        .filter(agent => {
          const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
          return hasDevcontainerConfig(agentDir)
        })
        .map(agent => ({
          name: agent.name,
          path: path.join(workspaceInfo.agentsPath, agent.name),
        }))

      if (agentsToRebuild.length === 0) {
        this.error('No agents with devcontainer configurations found.')
      }
    } else if (args.agent) {
      // Rebuild specific agent
      const agent = workspaceInfo.agents.find(a => a.name === args.agent)
      if (!agent) {
        this.error(`Agent "${args.agent}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`)
      }

      const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
      if (!hasDevcontainerConfig(agentDir)) {
        this.error(`Agent "${args.agent}" does not have a devcontainer configuration.`)
      }

      agentsToRebuild = [{ name: agent.name, path: agentDir }]
    } else {
      // Interactive selection
      const agentsWithDevcontainer = workspaceInfo.agents
        .filter(agent => {
          const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
          return hasDevcontainerConfig(agentDir)
        })

      if (agentsWithDevcontainer.length === 0) {
        this.error('No agents with devcontainer configurations found.')
      }

      const choices = [
        { name: '🔄 All agents', value: '__all__' },
        new inquirer.Separator(),
        ...agentsWithDevcontainer.map(a => ({ name: a.name, value: a.name })),
      ]

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent(s) to rebuild:',
          choices,
        },
      ])

      if (selected === '__all__') {
        agentsToRebuild = agentsWithDevcontainer.map(agent => ({
          name: agent.name,
          path: path.join(workspaceInfo.agentsPath, agent.name),
        }))
      } else {
        agentsToRebuild = [{
          name: selected,
          path: path.join(workspaceInfo.agentsPath, selected),
        }]
      }
    }

    // Get prlt channel from flag or workspace config
    const prltChannel = getPrltChannel(workspaceInfo.path, flags['prlt-channel'])

    this.log('')
    this.log(styles.header('Rebuild Devcontainers'))
    this.log('')
    this.log(styles.muted(`Agents to rebuild: ${agentsToRebuild.map(a => a.name).join(', ')}`))
    this.log(styles.muted(`Build options: ${flags.cache ? 'with cache' : 'no-cache'}, ${flags.parallel ? 'parallel' : 'sequential'}`))
    this.log(styles.muted(`prlt channel: ${prltChannel}`))
    this.log('')

    // Determine if we should regenerate configs
    let shouldRegenerate = flags.regenerate

    // If not explicitly set via flag and not in force mode, prompt the user
    if (!flags.regenerate && !flags.force) {
      const { regenerate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'regenerate',
          message: 'Regenerate devcontainer configs before rebuilding? (applies config changes)',
          default: true,
        },
      ])
      shouldRegenerate = regenerate
    }

    // Regenerate devcontainer configs if requested
    if (shouldRegenerate) {
      this.log(styles.muted('Regenerating devcontainer configurations...'))
      for (const agent of agentsToRebuild) {
        createDevcontainerConfig({
          agentName: agent.name,
          agentDir: agent.path,
          prltChannel,
        })
        this.log(styles.muted(`  ✓ ${agent.name}`))
      }
      this.log('')
    }

    // Confirm
    if (!flags.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `This will stop running containers and rebuild ${agentsToRebuild.length} agent(s). Continue?`,
          default: true,
        },
      ])

      if (!confirm) {
        this.log(styles.muted('Aborted.'))
        return
      }
    }

    // Open database to get container info
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    let db: Database.Database
    try {
      db = new Database(dbPath)
    } catch {
      this.error('Could not open workspace database.')
    }

    const containerStorage = new ContainerStorage(db)

    // Track results
    const results: Array<{ agent: string; success: boolean; error?: string }> = []

    try {
      if (flags.parallel) {
        // Parallel rebuild
        this.log(styles.muted('Starting parallel rebuild...'))
        this.log('')

        const promises = agentsToRebuild.map(async (agent) => {
          try {
            await this.rebuildAgent(agent, containerStorage, !flags.cache)
            return { agent: agent.name, success: true }
          } catch (error) {
            return {
              agent: agent.name,
              success: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }
        })

        const parallelResults = await Promise.all(promises)
        results.push(...parallelResults)
      } else {
        // Sequential rebuild
        for (const agent of agentsToRebuild) {
          try {
            await this.rebuildAgent(agent, containerStorage, !flags.cache)
            results.push({ agent: agent.name, success: true })
          } catch (error) {
            results.push({
              agent: agent.name,
              success: false,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }

      // Summary
      this.log('')
      this.log(styles.header('Rebuild Summary'))
      this.log('')

      const succeeded = results.filter(r => r.success)
      const failed = results.filter(r => !r.success)

      if (succeeded.length > 0) {
        this.log(styles.success(`✓ Rebuilt: ${succeeded.map(r => r.agent).join(', ')}`))
      }

      if (failed.length > 0) {
        this.log(styles.error(`✗ Failed: ${failed.map(r => r.agent).join(', ')}`))
        for (const f of failed) {
          this.log(styles.muted(`  ${f.agent}: ${f.error}`))
        }
      }

      this.log('')
    } finally {
      db.close()
    }
  }

  private async rebuildAgent(
    agent: { name: string; path: string },
    containerStorage: ContainerStorage,
    noCache: boolean
  ): Promise<void> {
    this.log(styles.muted(`\n── ${agent.name} ──`))

    // 1. Stop and remove existing container
    const existingContainers = containerStorage.listContainers()
      .filter(c => c.agentName === agent.name && c.status !== 'removed')

    for (const container of existingContainers) {
      this.log(styles.muted(`  Stopping container ${container.dockerId.substring(0, 12)}...`))
      try {
        execSync(`docker stop ${container.dockerId}`, { stdio: 'pipe' })
      } catch {
        // Container might already be stopped
      }

      this.log(styles.muted(`  Removing container ${container.dockerId.substring(0, 12)}...`))
      try {
        execSync(`docker rm ${container.dockerId}`, { stdio: 'pipe' })
        containerStorage.updateStatus(container.dockerId, 'removed')
      } catch {
        // Container might already be removed
      }
    }

    // Also check for containers via docker that might not be tracked
    try {
      const dockerOutput = execSync(
        `docker ps -a --filter "label=devcontainer.local_folder=${agent.path}" --format "{{.ID}}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (dockerOutput) {
        for (const containerId of dockerOutput.split('\n').filter(Boolean)) {
          this.log(styles.muted(`  Stopping container ${containerId.substring(0, 12)}...`))
          try {
            execSync(`docker stop ${containerId}`, { stdio: 'pipe' })
          } catch { /* ignore */ }

          this.log(styles.muted(`  Removing container ${containerId.substring(0, 12)}...`))
          try {
            execSync(`docker rm ${containerId}`, { stdio: 'pipe' })
          } catch { /* ignore */ }
        }
      }
    } catch {
      // No containers found via label, that's fine
    }

    // 2. Rebuild the devcontainer
    this.log(styles.muted(`  Building devcontainer...`))

    const buildArgs = ['up', '--workspace-folder', agent.path]
    if (noCache) {
      buildArgs.push('--no-cache')
    }
    buildArgs.push('--remove-existing-container')

    return new Promise((resolve, reject) => {
      const child = spawn('devcontainer', buildArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: agent.path,
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          this.log(styles.success(`  ✓ ${agent.name} rebuilt successfully`))
          resolve()
        } else {
          const errorMsg = stderr || stdout || `Exit code ${code}`
          this.log(styles.error(`  ✗ ${agent.name} rebuild failed`))
          reject(new Error(errorMsg.substring(0, 200)))
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }
}
