import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../../lib/prompt-json.js'
import { addCliTool } from '../../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../../lib/agents/commands.js'
import { styles } from '../../../lib/styles.js'

export default class ToolsAddCli extends PMOCommand {
  static description = 'Register a CLI tool'

  static examples = [
    '<%= config.bin %> <%= command.id %> gh --command gh --description "GitHub CLI" --detect "which gh" --install "brew install gh"',
    '<%= config.bin %> <%= command.id %> ffmpeg --command ffmpeg --description "Video processing" --detect "which ffmpeg"',
  ]

  static args = {
    name: Args.string({
      description: 'Name for the CLI tool',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    command: Flags.string({
      description: 'Command to invoke',
      required: true,
    }),
    description: Flags.string({
      char: 'd',
      description: 'Human-readable description',
      required: true,
    }),
    detect: Flags.string({
      description: 'Command to check if tool is installed (e.g., "which gh")',
    }),
    install: Flags.string({
      description: 'Install command hint (e.g., "brew install gh")',
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ToolsAddCli)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()

    const config = {
      command: flags.command,
      description: flags.description,
      ...(flags.detect ? { detect: flags.detect } : {}),
      ...(flags.install ? { install: flags.install } : {}),
    }

    addCliTool(workspaceInfo.path, args.name, config)

    if (jsonMode) {
      outputSuccessAsJson(
        { name: args.name, type: 'cli', config },
        createMetadata('tools add cli', flags)
      )
      return
    }

    this.logPlain(`${styles.success('Added CLI tool:')} ${styles.code(args.name)}`)
    this.logPlain(styles.muted(`  command: ${config.command}`))
  }
}
