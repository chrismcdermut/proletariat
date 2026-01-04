import { Command } from '@oclif/core'
import inquirer from 'inquirer'

export default class Works extends Command {
  static description = 'Bulk work operations (start work on multiple tickets)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> start --column "In Progress"',
  ]

  async run(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🚀 Start work on multiple tickets', value: 'start' },
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
      start: 'works:start',
    }

    if (commands[action]) {
      await this.config.runCommand(commands[action], [])
    }
  }
}
