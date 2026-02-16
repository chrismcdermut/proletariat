import { Args } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Link extends PMOCommand {
  static description = 'Manage links (dependencies) between entities'

  static examples = [
    '<%= config.bin %> <%= command.id %> create TKT-001 TKT-002 --type blocks',
    '<%= config.bin %> <%= command.id %> list TKT-001',
    '<%= config.bin %> <%= command.id %> remove TKT-001 TKT-002',
  ]

  static args = {
    action: Args.string({
      description: 'Action to perform',
      options: ['create', 'list', 'remove'],
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Link)

    const jsonMode = shouldOutputJson(flags)

    let action = args.action

    if (!action) {
      const menuChoices = [
        { name: 'Create a new link', value: 'create', command: 'prlt link create --help' },
        { name: 'List links for an entity', value: 'list', command: 'prlt link list --help' },
        { name: 'Remove a link', value: 'remove', command: 'prlt link remove --help' },
        { name: 'Cancel', value: 'cancel', command: '' },
      ]
      const message = 'What would you like to do?'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'action', message, menuChoices),
          createMetadata('link', flags)
        )
        return
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices: [
          ...menuChoices.slice(0, 3).map(c => ({ name: c.name, value: c.value })),
          new inquirer.Separator(),
          { name: menuChoices[3].name, value: menuChoices[3].value }
        ]
      }], null)

      if (selected === 'cancel') {
        this.log(styles.muted('\nCancelled.'))
        return
      }

      action = selected
    }

    // Show help for the selected action
    this.log(styles.muted(`\nUsage:`))
    switch (action) {
      case 'create':
        this.log('  prlt link create <from> <to> --type <blocks|relates|duplicates|depends>')
        this.log('')
        this.log('Examples:')
        this.log('  prlt link create TKT-001 TKT-002 --type blocks   # TKT-001 is blocked by TKT-002')
        this.log('  prlt link create SPEC-001 SPEC-002 --type depends # SPEC-001 depends on SPEC-002')
        break
      case 'list':
        this.log('  prlt link list <entity-id>')
        this.log('')
        this.log('Examples:')
        this.log('  prlt link list TKT-001       # List links for ticket')
        this.log('  prlt link list SPEC-001 --all # Include reverse links')
        break
      case 'remove':
        this.log('  prlt link remove <from> <to>')
        this.log('')
        this.log('Examples:')
        this.log('  prlt link remove TKT-001 TKT-002')
        this.log('  prlt link remove SPEC-001 SPEC-002 --type depends')
        break
    }
  }
}
