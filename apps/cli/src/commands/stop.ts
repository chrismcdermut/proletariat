/**
 * prlt stop <agent> — stop an agent
 *
 * Sends SIGTERM and kills the tmux session.
 * Works without HQ / PMO.
 */

import { Args } from '@oclif/core'
import { PromptCommand } from '../lib/prompt-command.js'
import { machineOutputFlags } from '../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { styles } from '../lib/styles.js'
import { SessionStore } from '../lib/session-store.js'
import { getRunner } from '../lib/runners/index.js'

export default class Stop extends PromptCommand {
  static description = 'Stop a running agent'

  static examples = [
    '<%= config.bin %> stop bold-fox',
    '<%= config.bin %> stop SES-ABC123',
  ]

  static args = {
    agent: Args.string({
      description: 'Agent name or session ID',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Stop)
    const jsonMode = shouldOutputJson(flags)

    const store = new SessionStore()
    try {
      const session = store.resolve(args.agent)

      if (!session) {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_FOUND', `No session found for "${args.agent}". Run "prlt ps" to see agents.`, createMetadata('stop', flags))
          return
        }
        this.error(`No session found for "${args.agent}". Run "prlt ps" to see agents.`)
      }

      if (session.status !== 'running') {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_RUNNING', `Session "${session.agentName}" is not running (status: ${session.status}).`, createMetadata('stop', flags))
          return
        }
        this.error(`Session "${session.agentName}" is not running (status: ${session.status}).`)
      }

      const runner = getRunner(session.runner)
      if (!runner) {
        if (jsonMode) {
          outputErrorAsJson('RUNNER_NOT_FOUND', `Runner "${session.runner}" not available.`, createMetadata('stop', flags))
          return
        }
        this.error(`Runner "${session.runner}" not available.`)
      }

      const agentSession = {
        id: session.id,
        runner: session.runner,
        sessionName: session.sessionName,
        task: session.task,
        workdir: session.workdir,
        startedAt: session.startedAt,
        status: 'running' as const,
      }

      await runner.stop(agentSession)
      store.updateStatus(session.id, 'stopped')

      if (jsonMode) {
        outputSuccessAsJson({
          id: session.id,
          agentName: session.agentName,
          status: 'stopped',
        }, createMetadata('stop', flags))
        return
      }

      this.log(styles.success(`✓ Stopped agent: ${session.agentName}`))
    } finally {
      store.close()
    }
  }
}
