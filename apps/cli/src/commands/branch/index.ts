import { Command } from '@oclif/core'
import inquirer from 'inquirer'

export default class Branch extends Command {
  static description = 'Interactive menu for branch operations'

  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '✨ Create new branch', value: 'create' },
          { name: '📋 List branches', value: 'list' },
          { name: '✅ Validate branch name', value: 'validate' },
          new inquirer.Separator(),
          { name: '❌ Cancel', value: 'cancel' },
        ],
      },
    ])

    if (action === 'cancel') {
      return
    }

    const commands: Record<string, string> = {
      create: 'branch:create',
      list: 'branch:list',
      validate: 'branch:validate',
    }

    if (commands[action]) {
      await this.config.runCommand(commands[action], [])
    }
  }
}
