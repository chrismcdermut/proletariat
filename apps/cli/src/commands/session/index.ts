import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Session extends PMOCommand {
  static description = 'Manage agent tmux sessions (list, attach, detach)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> attach TKT-347-implement',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Session)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Define choices
    const menuChoices = [
      { name: 'List active sessions', value: 'list' },
      { name: 'Attach to a session', value: 'attach' },
      { name: 'Cancel', value: 'cancel' },
    ]
    const message = 'Session Management - What would you like to do?'

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('session', flags)
      )
      return
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '🖥️  ' + message,
        choices: [
          { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
          { name: '🔗 ' + menuChoices[1].name, value: menuChoices[1].value },
          new inquirer.Separator(),
          { name: '❌ ' + menuChoices[2].name, value: menuChoices[2].value },
        ],
      },
    ])

    if (action === 'cancel') {
      return
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('session:list', [])
        break
      case 'attach':
        await this.config.runCommand('session:attach', [])
        break
    }
  }
}
