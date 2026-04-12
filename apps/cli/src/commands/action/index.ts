/**
 * prlt action — Manage work actions (intent-based pipeline definitions).
 */

import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class Action extends PMOCommand {
  static description = 'Manage work actions (intent-based pipeline definitions)'

  static examples = [
    '<%= config.bin %> action list',
    '<%= config.bin %> action show implement',
    '<%= config.bin %> action create test --to-intent testing --prompt "Run tests"',
    '<%= config.bin %> action delete my-action',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Action)
    const jsonMode = shouldOutputJson(flags)

    const menuChoices = [
      { id: 'list', name: 'List all actions', command: 'prlt action list --json' },
      { id: 'show', name: 'Show action details', command: 'prlt action show --json' },
      { id: 'create', name: 'Create a new action', command: 'prlt action create --json' },
      { id: 'delete', name: 'Delete an action', command: 'prlt action delete --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ]

    const action = await this.selectFromList({
      message: 'Work Actions - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'action' } : null,
    })

    if (action === 'cancel' || !action) return

    switch (action) {
      case 'list':
        await this.config.runCommand('action:list')
        break
      case 'show':
        await this.config.runCommand('action:show')
        break
      case 'create':
        await this.config.runCommand('action:create')
        break
      case 'delete':
        await this.config.runCommand('action:delete')
        break
    }
  }
}
