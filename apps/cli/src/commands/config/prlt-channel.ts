import { Args, Command } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { findHQRoot } from '../../lib/workspace.js'
import { getPrltConfig, updatePrltConfig, PrltChannel } from '../../lib/workspace-config.js'

export default class ConfigPrltChannel extends Command {
  static description = 'Get or set the prlt channel for container builds'

  static examples = [
    '<%= config.bin %> <%= command.id %>              # Show current channel',
    '<%= config.bin %> <%= command.id %> npm          # Use public npm @latest (default)',
    '<%= config.bin %> <%= command.id %> npm:dev      # Use public npm @dev tag',
    '<%= config.bin %> <%= command.id %> npm:1.2.3    # Use specific version from npm',
    '<%= config.bin %> <%= command.id %> gh           # Use GitHub Packages (needs GITHUB_TOKEN)',
    '<%= config.bin %> <%= command.id %> gh:dev       # Use GitHub Packages @dev tag',
    '<%= config.bin %> <%= command.id %> mount        # Use local build from PRLT_REPO_PATH',
  ]

  static args = {
    channel: Args.string({
      description: 'Channel: npm, npm:dev, npm:x.y.z, gh, gh:dev, or mount',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigPrltChannel)

    const hqPath = findHQRoot()
    if (!hqPath) {
      this.error('Not in an HQ workspace. Run "prlt init" first.')
    }

    if (args.channel) {
      // Set the channel
      updatePrltConfig(hqPath, { channel: args.channel as PrltChannel })
      this.log(styles.success(`prlt channel set to: ${args.channel}`))
      this.log('')
      this.log(styles.muted('To apply to containers, run:'))
      this.log(styles.muted('  prlt docker rebuild --regenerate'))
    } else {
      // Show current channel
      const config = getPrltConfig(hqPath)
      const channel = config.channel ?? 'npm (default)'
      this.log(`prlt channel: ${channel}`)
    }
  }
}
