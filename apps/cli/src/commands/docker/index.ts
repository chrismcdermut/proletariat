import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'

export default class Docker extends Command {
  static description = 'Manage Docker containers used by agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> docker status',
    '<%= config.bin %> docker list',
    '<%= config.bin %> docker clean',
  ]

  async run(): Promise<void> {
    this.log('')
    this.log(styles.header('Docker Management'))
    this.log('')

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Check Docker status', value: 'status' },
          { name: 'List containers', value: 'list' },
          { name: 'Clean orphaned containers', value: 'clean' },
          new inquirer.Separator(),
          { name: 'Exit', value: 'exit' },
        ],
      },
    ])

    if (action === 'exit') {
      return
    }

    await this.config.runCommand(`docker:${action}`, [])
  }
}
