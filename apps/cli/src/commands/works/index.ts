import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

export default class Works extends PMOCommand {
  static description = 'Bulk work operations (start work on multiple tickets)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> start --column "In Progress"',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
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
