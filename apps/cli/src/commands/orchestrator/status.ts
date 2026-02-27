import { Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames, captureTmuxPane } from '../../lib/execution/session-utils.js'
import { ORCHESTRATOR_SESSION_NAME } from './start.js'

export default class OrchestratorStatus extends PromptCommand {
  static description = 'Check if the orchestrator is running'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --peek',
    '<%= config.bin %> <%= command.id %> --peek --lines 50',
  ]

  static flags = {
    ...machineOutputFlags,
    peek: Flags.boolean({
      description: 'Show recent output from the orchestrator',
      default: false,
    }),
    lines: Flags.integer({
      description: 'Number of lines to show when peeking',
      default: 20,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorStatus)
    const jsonMode = shouldOutputJson(flags)

    const hostSessions = getHostTmuxSessionNames()
    const isRunning = hostSessions.includes(ORCHESTRATOR_SESSION_NAME)

    let recentOutput: string | null = null
    if (isRunning && flags.peek) {
      recentOutput = captureTmuxPane(ORCHESTRATOR_SESSION_NAME, flags.lines)
    }

    if (jsonMode) {
      outputSuccessAsJson({
        running: isRunning,
        sessionId: isRunning ? ORCHESTRATOR_SESSION_NAME : null,
        ...(recentOutput !== null && { recentOutput }),
      }, createMetadata('orchestrator status', flags as Record<string, unknown>))
      return
    }

    this.log('')
    if (isRunning) {
      this.log(styles.success(`Orchestrator is running`))
      this.log(styles.muted(`   Session: ${ORCHESTRATOR_SESSION_NAME}`))
      this.log(styles.muted(`   Attach: prlt orchestrator attach`))
      this.log(styles.muted(`   Poke:   prlt session poke orchestrator "message"`))

      if (recentOutput) {
        this.log('')
        this.log(styles.header('Recent output:'))
        this.log(styles.muted('─'.repeat(60)))
        this.log(recentOutput)
        this.log(styles.muted('─'.repeat(60)))
      }
    } else {
      this.log(styles.muted('Orchestrator is not running.'))
      this.log(styles.muted('Start it with: prlt orchestrator start'))
    }
    this.log('')
  }
}
