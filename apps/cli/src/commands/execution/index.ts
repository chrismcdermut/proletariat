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
          { name: '📜 View logs for an execution', value: 'logs' },
          { name: '🛑 Stop an execution', value: 'stop' },
          new inquirer.Separator(),
          { name: '📋 List all executions', value: 'list' },
          new inquirer.Separator(),
          { name: '❌ Cancel', value: 'cancel' },
        ],
      },
    ])

    if (action === 'cancel') {
      return
    }

    // Run the selected subcommand
    const commands: Record<string, string> = {
      logs: 'execution:logs',
      stop: 'execution:stop',
      list: 'executions:list',
    }

    if (commands[action]) {
      await this.config.runCommand(commands[action], [])
    }
  }
}
