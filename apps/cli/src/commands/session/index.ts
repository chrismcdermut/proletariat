
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class Session extends PMOCommand {
  static description = 'Manage agent tmux sessions (list, attach, create, detach)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> attach TKT-347-implement',
    '<%= config.bin %> <%= command.id %> create my-session',
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
        { name: 'Inspect agent status', value: 'inspect', command: 'prlt session inspect --json' },
        { name: 'Create a new session', value: 'create', command: 'prlt session create --json' },
        { name: 'Attach to a session', value: 'attach', command: 'prlt session attach --json' },
        { name: 'Peek at agent output', value: 'peek', command: 'prlt session peek --json' },
        { name: 'Check agent health', value: 'health', command: 'prlt session health --json' },
        { name: 'Poke a running agent', value: 'poke', command: 'prlt session poke --json' },
        { name: 'Execute command in agent context', value: 'exec', command: 'prlt session exec --json' },
        { name: 'Restart an agent session', value: 'restart', command: 'prlt session restart --json' },
        { name: 'Prune stale sessions', value: 'prune', command: 'prlt session prune --json' },
        { name: 'Clean up dead containers', value: 'cleanup', command: 'prlt session cleanup --json' },
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
      case 'inspect':
        await this.config.runCommand('session:inspect', [])
        break
      case 'create':
        await this.config.runCommand('session:create', [])
        break
      case 'attach':
        await this.config.runCommand('session:attach', [])
        break
      case 'peek':
        await this.config.runCommand('session:peek', [])
        break
      case 'health':
        await this.config.runCommand('session:health', [])
        break
      case 'poke':
        await this.config.runCommand('session:poke', [])
        break
      case 'exec':
        await this.config.runCommand('session:exec', [])
        break
      case 'restart':
        await this.config.runCommand('session:restart', [])
        break
      case 'prune':
        await this.config.runCommand('session:prune', [])
        break
      case 'cleanup':
        await this.config.runCommand('session:cleanup', [])
        break
    }
  }
}
