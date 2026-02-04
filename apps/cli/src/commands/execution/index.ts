import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

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
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Execution)

    const jsonModeConfig = flags.json ? { flags, commandName: 'execution' } : null

    const { action } = await this.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 List all executions', value: 'list', command: 'prlt execution list --json' },
          { name: '📜 View logs for an execution', value: 'logs', command: 'prlt execution logs --json' },
          { name: '🛑 Stop an execution', value: 'stop', command: 'prlt execution stop --json' },
          { name: '🛑 Stop all running', value: 'stop-all', command: 'prlt execution stop --all --json' },
          new inquirer.Separator(),
          { name: '❌ Cancel', value: 'cancel', command: '' },
        ],
      },
    ], jsonModeConfig)

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
