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
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Branch)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'create', name: 'Create new branch', command: 'prlt branch create --json' },
      { id: 'list', name: 'List branches', command: 'prlt branch list --format json' },
      { id: 'validate', name: 'Validate branch name', command: 'prlt branch validate' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ]
    const message = 'What would you like to do?'

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'branch' } : null,
    })

    if (action === 'cancel' || !action) {
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
