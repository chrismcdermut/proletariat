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
import { findHQRoot } from '../../lib/workspace.js'
import { getHeadquartersNameFromPath } from '../../lib/machine-config.js'
import { buildOrchestratorSessionName, findRunningOrchestratorSessions } from './start.js'

export default class OrchestratorStatus extends PromptCommand {
  static description = 'Check if the orchestrator is running'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --peek',
    '<%= config.bin %> <%= command.id %> --peek --lines 50',
  ]

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      char: 'n',
      description: 'Name of the orchestrator session to check (default: main)',
    }),
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

    // Resolve session name: try HQ-scoped first, fall back to discovery
    let sessionName: string | undefined
    const hqPath = findHQRoot(process.cwd())
    if (hqPath) {
      const hqName = getHeadquartersNameFromPath(hqPath)
      sessionName = buildOrchestratorSessionName(hqName, flags.name || 'main')
    }

    // If in HQ, check specifically for this HQ's session
    if (sessionName) {
      const isRunning = hostSessions.includes(sessionName)

      let recentOutput: string | null = null
      if (isRunning && flags.peek) {
        recentOutput = captureTmuxPane(sessionName, flags.lines)
      }

      if (jsonMode) {
        outputSuccessAsJson({
          running: isRunning,
          sessionId: isRunning ? sessionName : null,
          ...(recentOutput !== null && { recentOutput }),
        }, createMetadata('orchestrator status', flags as Record<string, unknown>))
        return
      }

      this.log('')
      if (isRunning) {
        this.log(styles.success(`Orchestrator is running`))
        this.log(styles.muted(`   Session: ${sessionName}`))
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
      return
    }

    // Not in HQ — discover all running orchestrator sessions
    const runningSessions = findRunningOrchestratorSessions(hostSessions)

    if (jsonMode) {
      outputSuccessAsJson({
        running: runningSessions.length > 0,
        sessions: runningSessions,
      }, createMetadata('orchestrator status', flags as Record<string, unknown>))
      return
    }

    this.log('')
    if (runningSessions.length === 0) {
      this.log(styles.muted('No orchestrator sessions running.'))
      this.log(styles.muted('Start one with: prlt orchestrator start'))
    } else {
      this.log(styles.success(`${runningSessions.length} orchestrator session(s) running:`))
      for (const s of runningSessions) {
        this.log(styles.muted(`   ${s}`))
        if (flags.peek) {
          const output = captureTmuxPane(s, flags.lines)
          if (output) {
            this.log(styles.muted('─'.repeat(60)))
            this.log(output)
            this.log(styles.muted('─'.repeat(60)))
          }
        }
      }
    }
    this.log('')
  }
}
