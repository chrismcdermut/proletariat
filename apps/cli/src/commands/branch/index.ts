import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Branch extends PMOCommand {
  static description = 'Interactive menu for branch operations'

  static examples = ['<%= config.bin %> <%= command.id %>']

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
    const { flags } = await this.parse(Branch)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Create new branch', value: 'create' },
      { name: 'List branches', value: 'list' },
      { name: 'Validate branch name', value: 'validate' },
      { name: 'Cancel', value: 'cancel' },
    ]
    const message = 'What would you like to do?'

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('branch', flags)
      )
      return
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message,
        choices: [
          { name: '✨ ' + menuChoices[0].name, value: menuChoices[0].value },
          { name: '📋 ' + menuChoices[1].name, value: menuChoices[1].value },
          { name: '✅ ' + menuChoices[2].name, value: menuChoices[2].value },
          new inquirer.Separator(),
          { name: '❌ ' + menuChoices[3].name, value: menuChoices[3].value },
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
