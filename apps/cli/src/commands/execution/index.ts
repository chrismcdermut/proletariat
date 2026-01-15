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
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
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
