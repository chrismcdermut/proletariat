
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ORCHESTRATOR_SESSION_NAME } from './start.js'

export default class Orchestrator extends PMOCommand {
  static description = 'Manage the orchestrator agent (start, attach, status, stop)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> start',
    '<%= config.bin %> <%= command.id %> attach',
    '<%= config.bin %> <%= command.id %> status',
    '<%= config.bin %> <%= command.id %> stop',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Orchestrator)

    const jsonModeConfig = shouldOutputJson(flags) ? { flags, commandName: 'orchestrator' } : null

    // Check if orchestrator is currently running to offer contextual options
    const hostSessions = getHostTmuxSessionNames()
    const isRunning = hostSessions.includes(ORCHESTRATOR_SESSION_NAME)

    // When running, show "Attach to running session" first since that's the likely intent
    const choices = isRunning
      ? [
          { name: 'Attach to running session', value: 'attach', command: 'prlt orchestrator attach --json' },
          { name: 'Start orchestrator', value: 'start', command: 'prlt orchestrator start --json' },
          { name: 'Check orchestrator status', value: 'status', command: 'prlt orchestrator status --json' },
          { name: 'Stop orchestrator', value: 'stop', command: 'prlt orchestrator stop --json' },
          { name: 'Cancel', value: 'cancel' },
        ]
      : [
          { name: 'Start orchestrator', value: 'start', command: 'prlt orchestrator start --json' },
          { name: 'Attach to orchestrator', value: 'attach', command: 'prlt orchestrator attach --json' },
          { name: 'Check orchestrator status', value: 'status', command: 'prlt orchestrator status --json' },
          { name: 'Stop orchestrator', value: 'stop', command: 'prlt orchestrator stop --json' },
          { name: 'Cancel', value: 'cancel' },
        ]

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'Orchestrator - What would you like to do?',
      choices,
    }], jsonModeConfig)

    if (action === 'cancel') {
      return
    }

    switch (action) {
      case 'start':
        await this.config.runCommand('orchestrator:start', [])
        break
      case 'attach':
        await this.config.runCommand('orchestrator:attach', [])
        break
      case 'status':
        await this.config.runCommand('orchestrator:status', [])
        break
      case 'stop':
        await this.config.runCommand('orchestrator:stop', [])
        break
    }
  }
}
