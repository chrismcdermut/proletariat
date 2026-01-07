import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'

export default class Docker extends Command {
  static description = 'Manage Docker containers used by agents'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> docker status',
    '<%= config.bin %> docker list',
    '<%= config.bin %> docker logs WORK-001',
    '<%= config.bin %> docker stop kalanick',
    '<%= config.bin %> docker shell WORK-001',
    '<%= config.bin %> docker restart abc123',
    '<%= config.bin %> docker clean',
    '<%= config.bin %> docker prune',
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
          { name: 'View container logs', value: 'logs' },
          { name: 'Stop a container', value: 'stop' },
          { name: 'Shell into container', value: 'shell' },
          { name: 'Restart a container', value: 'restart' },
          new inquirer.Separator(),
          { name: 'Clean orphaned containers', value: 'clean' },
          { name: 'Prune unused resources', value: 'prune' },
          new inquirer.Separator(),
          { name: 'Exit', value: 'exit' },
        ],
      },
    ])

    if (action === 'exit') {
      return
    }

    // Commands that require a target
    const targetCommands = ['logs', 'stop', 'shell', 'restart']

    if (targetCommands.includes(action)) {
      const { target } = await inquirer.prompt([
        {
          type: 'input',
          name: 'target',
          message: 'Enter execution ID (WORK-XXX), agent name, or container ID:',
          validate: (input: string) => input.trim().length > 0 || 'Target is required',
        },
      ])

      await this.config.runCommand(`docker:${action}`, [target.trim()])
    } else {
      await this.config.runCommand(`docker:${action}`, [])
    }
  }
}
