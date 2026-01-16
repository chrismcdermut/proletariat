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
    json: Flags.boolean({ description: 'Output prompt configuration as JSON (for AI agents/scripts)', default: false }),
    'no-interactive': Flags.boolean({ description: 'Alias for --json flag', default: false }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Execution)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // In JSON mode, output menu prompt
    if (jsonMode) {
      const menuChoices = [
        { name: 'List all executions', value: 'list' },
        { name: 'View logs for an execution', value: 'logs' },
        { name: 'Stop an execution', value: 'stop' },
        { name: 'Stop all running', value: 'stop-all' },
        { name: 'Cancel', value: 'cancel' },
      ]
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'What would you like to do?', menuChoices),
        createMetadata('execution', flags)
      )
      return
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 List all executions', value: 'list' },
          { name: '📜 View logs for an execution', value: 'logs' },
          { name: '🛑 Stop an execution', value: 'stop' },
          { name: '🛑 Stop all running', value: 'stop-all' },
          new inquirer.Separator(),
          { name: '❌ Cancel', value: 'cancel' },
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
