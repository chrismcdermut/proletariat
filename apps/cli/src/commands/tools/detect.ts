import { Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { findHQRoot } from '../../lib/workspace.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  loadToolRegistry,
  detectAvailableTools,
  addCliTool,
} from '../../lib/tool-registry/index.js'

export default class ToolsDetect extends Command {
  static description = 'Auto-detect common CLI tools on the system and register them'

  static examples = [
    '<%= config.bin %> tools detect',
    '<%= config.bin %> tools detect --auto',
    '<%= config.bin %> tools detect --json',
  ]

  static flags = {
    ...machineOutputFlags,
    auto: Flags.boolean({
      description: 'Automatically register all detected tools without prompting',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ToolsDetect)
    const jsonMode = shouldOutputJson(flags)

    const hqPath = findHQRoot()
    if (!hqPath) {
      if (jsonMode) {
        this.log(JSON.stringify({ error: 'Not in a proletariat workspace' }))
      } else {
        this.error('Not in a proletariat workspace. Run `prlt init` first.')
      }
      return
    }

    const registry = loadToolRegistry(hqPath)
    const detected = detectAvailableTools(registry)

    if (detected.length === 0) {
      if (jsonMode) {
        this.log(JSON.stringify({ detected: [], message: 'No new tools detected' }))
      } else {
        this.log(chalk.dim('\nNo new CLI tools detected (all common tools already registered or not found).'))
        this.log('')
      }
      return
    }

    if (jsonMode) {
      const choices = detected.map(t => ({
        name: `${t.name} (${t.command}) — ${t.description}`,
        value: t.name,
      }))
      const message = `${detected.length} CLI tools detected. Select tools to register:`
      outputPromptAsJson(
        buildPromptConfig('checkbox', 'tools', message, choices),
        createMetadata('tools detect', flags as Record<string, unknown>)
      )
      return
    }

    this.log('')
    this.log(chalk.bold(`Detected ${detected.length} CLI tools:`))
    this.log('─'.repeat(40))
    for (const tool of detected) {
      this.log(`  ${chalk.green('✓')} ${chalk.bold(tool.name)} (${tool.command}) — ${tool.description}`)
    }
    this.log('')

    if (flags.auto) {
      for (const tool of detected) {
        addCliTool(hqPath, tool.name, {
          command: tool.command,
          description: tool.description,
          detect: tool.detect,
          install: tool.install,
        })
      }
      this.log(chalk.green(`Registered ${detected.length} tools.`))
      this.log('')
      return
    }

    const choices = detected.map(t => ({
      name: `${t.name} — ${t.description}`,
      value: t.name,
      checked: true,
    }))

    const { selected } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selected',
      message: 'Select tools to register:',
      choices,
    }])

    if (selected.length === 0) {
      this.log(chalk.dim('No tools selected.'))
      this.log('')
      return
    }

    const selectedSet = new Set(selected as string[])
    for (const tool of detected) {
      if (selectedSet.has(tool.name)) {
        addCliTool(hqPath, tool.name, {
          command: tool.command,
          description: tool.description,
          detect: tool.detect,
          install: tool.install,
        })
      }
    }

    this.log(chalk.green(`\nRegistered ${selected.length} tools.`))
    this.log('')
  }
}
