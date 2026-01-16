import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Execution extends PMOCommand {
  static description = 'Single execution operations (logs, stop)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> logs WORK-001',
    '<%= config.bin %> <%= command.id %> stop WORK-001',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Execution)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List all executions', value: 'list' },
      { name: 'View logs for an execution', value: 'logs' },
      { name: 'Stop an execution', value: 'stop' },
      { name: 'Stop all running', value: 'stop-all' },
      { name: 'Cancel', value: 'cancel' },
    ]
    const message = 'What would you like to do?'

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('execution', flags)
      )
      return
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message,
        choices: [
          { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
          { name: '📜 ' + menuChoices[1].name, value: menuChoices[1].value },
          { name: '🛑 ' + menuChoices[2].name, value: menuChoices[2].value },
          { name: '🛑 ' + menuChoices[3].name, value: menuChoices[3].value },
          new inquirer.Separator(),
          { name: '❌ ' + menuChoices[4].name, value: menuChoices[4].value },
        ],
      },
    ])

    if (action === 'cancel') {
      return
    }

    // Run the selected subcommand
    const commands: Record<string, { cmd: string; args: string[] }> = {
      list: { cmd: 'execution:list', args: [] },
      logs: { cmd: 'execution:logs', args: [] },
      stop: { cmd: 'execution:stop', args: [] },
      'stop-all': { cmd: 'execution:stop', args: ['--all'] },
    }

    const command = commands[action]
    if (command) {
      await this.config.runCommand(command.cmd, command.args)
    }
  }
}
