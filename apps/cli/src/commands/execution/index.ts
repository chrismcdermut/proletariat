import { Command } from '@oclif/core'
import inquirer from 'inquirer'

export default class Execution extends Command {
  static description = 'Interactive menu for execution operations'

  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 List executions', value: 'list' },
          { name: '📜 View logs', value: 'logs' },
          { name: '🛑 Stop execution', value: 'stop' },
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
      list: 'execution:list',
      logs: 'execution:logs',
      stop: 'execution:stop',
    }

    if (commands[action]) {
      await this.config.runCommand(commands[action], [])
    }
  }
}
