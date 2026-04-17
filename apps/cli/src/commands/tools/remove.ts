import { Args, Command } from '@oclif/core'
import chalk from 'chalk'
import { findHQRoot } from '../../lib/workspace.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { removeTool } from '../../lib/tool-registry/index.js'

export default class ToolsRemove extends Command {
  static description = 'Remove a tool from the registry'

  static examples = [
    '<%= config.bin %> tools remove arcade',
    '<%= config.bin %> tools remove ffmpeg',
  ]

  static args = {
    name: Args.string({
      description: 'Tool name to remove',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ToolsRemove)
    const jsonMode = shouldOutputJson(flags)
    const meta = () => createMetadata('tools remove', flags as Record<string, unknown>)

    const hqPath = findHQRoot()
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_WORKSPACE', 'Not in a proletariat workspace', meta())
        return
      } else {
        this.error('Not in a proletariat workspace. Run `prlt init` first.')
      }
      return
    }

    const removed = removeTool(hqPath, args.name)

    if (!removed) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Tool '${args.name}' not found or is a built-in tool`, meta())
        return
      } else {
        this.error(`Tool '${args.name}' not found in registry, or is a built-in tool that cannot be removed.`)
      }
      return
    }

    if (jsonMode) {
      outputSuccessAsJson({ name: args.name, removed: true }, meta())
      
    } else {
      this.log(chalk.green(`\nTool '${args.name}' removed from registry.`))
      this.log('')
    }
  }
}
