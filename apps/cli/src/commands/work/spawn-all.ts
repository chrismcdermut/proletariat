import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

export default class WorkSpawnAll extends PMOCommand {
  static description = 'Spawn work on all backlog tickets (alias for "work start --all")'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --skip-permissions',
    '<%= config.bin %> <%= command.id %> --create-pr',
  ]

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if work already in progress',
      default: false,
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission prompts (danger mode)',
      default: false,
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready',
      default: false,
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkSpawnAll)

    // Build args for work start --all
    const args = ['--all']
    if (flags.force) args.push('--force')
    if (flags['run-on-host']) args.push('--run-on-host')
    if (flags['skip-permissions']) args.push('--skip-permissions')
    if (flags['create-pr']) args.push('--create-pr')
    if (flags.executor) args.push('--executor', flags.executor)

    // Use oclif's run method to invoke work start
    await this.config.runCommand('work:start', args)
  }
}
