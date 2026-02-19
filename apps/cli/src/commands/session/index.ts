
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class Session extends PMOCommand {
  static description = 'Manage agent tmux sessions (list, attach, detach)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> attach TKT-347-implement',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Session)

    const jsonModeConfig = shouldOutputJson(flags) ? { flags, commandName: 'session' } : null

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'Session Management - What would you like to do?',
      choices: [
        { name: 'List active sessions', value: 'list', command: 'prlt session list --json' },
        { name: 'Attach to a session', value: 'attach', command: 'prlt session attach --json' },
        { name: 'Check agent health', value: 'health', command: 'prlt session health --json' },
        { name: 'Poke a running agent', value: 'poke', command: 'prlt session poke --json' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }], jsonModeConfig)

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
      case 'health':
        await this.config.runCommand('session:health', [])
        break
      case 'poke':
        await this.config.runCommand('session:poke', [])
        break
    }
  }
}
