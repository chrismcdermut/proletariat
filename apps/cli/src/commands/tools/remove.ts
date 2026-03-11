import { Args } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { removeTool, readToolRegistry } from '../../lib/tool-registry.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { styles } from '../../lib/styles.js'

export default class ToolsRemove extends PMOCommand {
  static description = 'Remove a tool from the registry'

  static examples = [
    '<%= config.bin %> <%= command.id %> arcade',
    '<%= config.bin %> <%= command.id %> ffmpeg',
  ]

  static args = {
    name: Args.string({
      description: 'Name of the tool to remove',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ToolsRemove)
    const jsonMode = shouldOutputJson(flags)

    const workspaceInfo = getWorkspaceInfo()
    const result = removeTool(workspaceInfo.path, args.name)

    if (result.wasBuiltin) {
      const msg = `Cannot remove built-in tool: ${args.name}`
      if (jsonMode) {
        this.error(msg)
      }
      this.error(msg)
    }

    if (!result.removed) {
      const msg = `Tool not found: ${args.name}`
      if (jsonMode) {
        this.error(msg)
      }
      this.error(msg)
    }

    if (jsonMode) {
      outputSuccessAsJson(
        { name: args.name, type: result.type },
        createMetadata('tools remove', flags)
      )
      return
    }

    this.logPlain(`${styles.success('Removed')} ${result.type} tool: ${styles.code(args.name)}`)
  }
}
