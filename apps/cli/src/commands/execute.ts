import { Command, Args, Flags } from '@oclif/core'

/**
 * Alias for `ticket execute` - allows running `prlt execute` directly
 */
export default class Execute extends Command {
  static description = 'Execute a ticket (alias for ticket execute)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode tmux',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to execute',
      required: false,
    }),
  }

  static flags = {
    mode: Flags.string({
      char: 'm',
      description: 'Execution mode',
      options: ['foreground', 'background', 'tmux', 'terminal', 'docker', 'vm'],
    }),
    agent: Flags.string({
      char: 'a',
      description: 'Override agent to use',
    }),
    branch: Flags.boolean({
      char: 'b',
      description: 'Create branch for work',
      default: true,
      allowNo: true,
    }),
    'docker-image': Flags.string({
      description: 'Docker image (for docker mode)',
    }),
    'vm-host': Flags.string({
      description: 'VM host (for vm mode)',
    }),
    'vm-user': Flags.string({
      description: 'VM user (for vm mode)',
    }),
    'vm-path': Flags.string({
      description: 'Remote path on VM (for vm mode)',
    }),
    'sync-strategy': Flags.string({
      description: 'Sync strategy for VM (git or rsync)',
      options: ['git', 'rsync'],
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Execute)

    // Build args array for ticket:execute
    const execArgs: string[] = []

    if (args.ticketId) {
      execArgs.push(args.ticketId)
    }

    // Pass through all flags
    if (flags.mode) {
      execArgs.push('--mode', flags.mode)
    }
    if (flags.agent) {
      execArgs.push('--agent', flags.agent)
    }
    if (flags.branch === false) {
      execArgs.push('--no-branch')
    }
    if (flags['docker-image']) {
      execArgs.push('--docker-image', flags['docker-image'])
    }
    if (flags['vm-host']) {
      execArgs.push('--vm-host', flags['vm-host'])
    }
    if (flags['vm-user']) {
      execArgs.push('--vm-user', flags['vm-user'])
    }
    if (flags['vm-path']) {
      execArgs.push('--vm-path', flags['vm-path'])
    }
    if (flags['sync-strategy']) {
      execArgs.push('--sync-strategy', flags['sync-strategy'])
    }

    // Run ticket:execute with the args
    await this.config.runCommand('ticket:execute', execArgs)
  }
}
