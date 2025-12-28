import { Command } from '@oclif/core'
import inquirer from 'inquirer'

export default class Executions extends Command {
  static description = 'Overview and bulk operations for agent executions'

  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 List all executions', value: 'list' },
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
      list: { cmd: 'executions:list', args: [] },
      'stop-all': { cmd: 'executions:stop', args: ['--all'] },
    }

    const command = commands[action]
    if (command) {
      await this.config.runCommand(command.cmd, command.args)
    }
  }
}
