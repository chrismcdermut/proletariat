import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'

export default class Devcontainer extends Command {
  static description = 'Manage devcontainer configurations for agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> devcontainer generate',
    '<%= config.bin %> devcontainer generate --all',
  ]

  async run(): Promise<void> {
    this.log('')
    this.log(styles.header('Devcontainer Management'))
    this.log('')

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Generate/regenerate devcontainer configs', value: 'generate' },
          new inquirer.Separator(),
          { name: styles.muted('Cancel'), value: 'cancel' },
        ],
      },
    ])

    if (action === 'cancel') {
      return
    }

    await this.config.runCommand(`devcontainer:${action}`, [])
  }
}
