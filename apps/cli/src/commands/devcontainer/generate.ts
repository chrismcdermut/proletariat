import { Args, Flags, Command } from '@oclif/core'
import * as path from 'node:path'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { createDevcontainerConfig, hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import { getPrltChannel } from '../../lib/workspace-config.js'
import { findHQRoot } from '../../lib/workspace.js'

export default class DevcontainerGenerate extends Command {
  static description = 'Generate or regenerate devcontainer configuration files for agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Interactive agent selection',
    '<%= config.bin %> <%= command.id %> altman             # Generate for specific agent',
    '<%= config.bin %> <%= command.id %> --all              # Generate for all agents',
    '<%= config.bin %> <%= command.id %> --all --force      # Overwrite existing configs',
  ]

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Generate for all agents',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing devcontainer configs',
      default: false,
    }),
    'prlt-channel': Flags.string({
      description: 'Override prlt channel (npm, npm:dev, gh, gh:dev, mount)',
      helpValue: 'CHANNEL',
    }),
  }

  static args = {
    agent: Args.string({
      description: 'Agent name to generate config for',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DevcontainerGenerate)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    const hqPath = findHQRoot()
    if (!hqPath) {
      this.error('Not in an HQ workspace. Run "prlt init" first.')
    }

    // Get prlt channel from config or override
    const prltChannel = getPrltChannel(hqPath, flags['prlt-channel'])

    // Determine which agents to generate for
    let agentsToGenerate: Array<{ name: string; path: string }> = []

    if (flags.all) {
      agentsToGenerate = workspaceInfo.agents.map((agent: { name: string }) => ({
        name: agent.name,
        path: path.join(workspaceInfo.agentsPath, agent.name),
      }))
    } else if (args.agent) {
      const agent = workspaceInfo.agents.find((a: { name: string }) => a.name === args.agent)
      if (!agent) {
        this.error(`Agent "${args.agent}" not found.`)
      }
      agentsToGenerate = [{
        name: agent.name,
        path: path.join(workspaceInfo.agentsPath, agent.name),
      }]
    } else {
      // Interactive selection
      if (workspaceInfo.agents.length === 0) {
        this.error('No agents found in workspace.')
      }

      const choices = workspaceInfo.agents.map((agent: { name: string }) => {
        const agentPath = path.join(workspaceInfo.agentsPath, agent.name)
        const hasConfig = hasDevcontainerConfig(agentPath)
        const suffix = hasConfig ? styles.muted(' (has config)') : ''
        return { name: `${agent.name}${suffix}`, value: agent.name }
      })

      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: 'Select agents to generate devcontainer configs for:',
          choices: [
            ...choices,
            new inquirer.Separator(),
            { name: 'All agents', value: '__all__' },
          ],
          validate: (input) => input.length > 0 || 'Please select at least one agent',
        },
      ])

      if (selected.includes('__all__')) {
        agentsToGenerate = workspaceInfo.agents.map((agent: { name: string }) => ({
          name: agent.name,
          path: path.join(workspaceInfo.agentsPath, agent.name),
        }))
      } else {
        agentsToGenerate = selected.map((name: string) => ({
          name,
          path: path.join(workspaceInfo.agentsPath, name),
        }))
      }
    }

    if (agentsToGenerate.length === 0) {
      this.log(styles.muted('No agents selected.'))
      return
    }

    this.log('')
    this.log(styles.header('Generate Devcontainer Configs'))
    this.log('')
    this.log(styles.muted(`Agents: ${agentsToGenerate.map(a => a.name).join(', ')}`))
    this.log(styles.muted(`prlt channel: ${prltChannel}`))
    this.log('')

    let generated = 0
    let skipped = 0

    for (const agent of agentsToGenerate) {
      const hasConfig = hasDevcontainerConfig(agent.path)

      if (hasConfig && !flags.force) {
        this.log(styles.muted(`  ○ ${agent.name}: skipped (already has config, use --force to overwrite)`))
        skipped++
        continue
      }

      try {
        createDevcontainerConfig({
          agentName: agent.name,
          agentDir: agent.path,
          prltChannel,
        })
        const action = hasConfig ? 'regenerated' : 'generated'
        this.log(styles.success(`  ✓ ${agent.name}: ${action}`))
        generated++
      } catch (error) {
        this.log(styles.error(`  ✗ ${agent.name}: failed - ${error instanceof Error ? error.message : String(error)}`))
      }
    }

    this.log('')
    this.log(styles.muted(`Generated: ${generated}, Skipped: ${skipped}`))

    if (generated > 0) {
      this.log('')
      this.log(styles.muted('To apply changes, rebuild the containers:'))
      this.log(styles.muted('  prlt docker rebuild --all'))
    }
  }
}
