import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { shouldOutputJson } from '../../../lib/prompt-json.js'

export default class WorkHooks extends PMOCommand {
  static description = 'Interactive menu for work lifecycle hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkHooks)
    const jsonMode = shouldOutputJson(flags)

    const menuChoices = [
      { id: 'list', name: 'List configured hooks', command: 'prlt work hooks list --json' },
      { id: 'add', name: 'Add a new hook', command: 'prlt work hooks add --json' },
      { id: 'remove', name: 'Remove a hook', command: 'prlt work hooks remove --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ]

    const action = await this.selectFromList({
      message: 'Work Lifecycle Hooks - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'work hooks' } : null,
    })

    if (action === 'cancel' || !action) {
      return
    }

    switch (action) {
      case 'list':
        await this.config.runCommand('work:hooks:list')
        break
      case 'add':
        await this.config.runCommand('work:hooks:add')
        break
      case 'remove':
        await this.config.runCommand('work:hooks:remove')
        break
    }
  }
}
