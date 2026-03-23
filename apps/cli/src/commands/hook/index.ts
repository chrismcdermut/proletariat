/**
 * prlt hook — Interactive menu for orchestrate hooks.
 */

import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class Hook extends PMOCommand {
  static description = 'Manage orchestrate hooks (event-driven pipeline automation)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> hook fire on_ci_green --pr 123',
    '<%= config.bin %> hook list',
    '<%= config.bin %> hook preset supervised',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Hook)
    const jsonMode = shouldOutputJson(flags)

    const menuChoices = [
      { id: 'list', name: 'List configured hooks', command: 'prlt hook list --json' },
      { id: 'fire', name: 'Fire an event', command: 'prlt hook fire --json' },
      { id: 'preset', name: 'Apply a preset', command: 'prlt hook preset --json' },
      { id: 'add', name: 'Add a new hook', command: 'prlt work hooks add --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ]

    const action = await this.selectFromList({
      message: 'Orchestrate Hooks - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'hook' } : null,
    })

    if (action === 'cancel' || !action) return

    switch (action) {
      case 'list':
        await this.config.runCommand('hook:list')
        break
      case 'fire':
        await this.config.runCommand('hook:fire')
        break
      case 'preset':
        await this.config.runCommand('hook:preset')
        break
      case 'add':
        await this.config.runCommand('work:hooks:add')
        break
    }
  }
}
