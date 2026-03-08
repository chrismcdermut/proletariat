/**
 * prlt poke <agent> <message> — send message to agent
 *
 * Sends keystrokes to the agent's tmux pane.
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

export default class Poke extends PromptCommand {
  static description = 'Send a message to a running agent'

  static examples = [
    '<%= config.bin %> poke bold-fox "focus on the login bug"',
    '<%= config.bin %> poke bold-fox "yes"',
    '<%= config.bin %> poke SES-ABC123 "approved"',
  ]

  static args = {
    agent: Args.string({
      description: 'Agent name or session ID',
      required: true,
    }),
    message: Args.string({
      description: 'Message to send to the agent',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Poke)
    const jsonMode = shouldOutputJson(flags)

    const store = new SessionStore()
    try {
      store.reconcile()
      const session = store.resolve(args.agent)

      if (!session) {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_FOUND', `No session found for "${args.agent}". Run "prlt ps" to see agents.`, createMetadata('poke', flags))
          return
        }
        this.error(`No session found for "${args.agent}". Run "prlt ps" to see agents.`)
      }

      if (session.status !== 'running') {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_RUNNING', `Session "${session.agentName}" is not running (status: ${session.status}).`, createMetadata('poke', flags))
          return
        }
        this.error(`Session "${session.agentName}" is not running (status: ${session.status}).`)
      }

      const runner = getRunner(session.runner)
      if (!runner) {
        if (jsonMode) {
          outputErrorAsJson('RUNNER_NOT_FOUND', `Runner "${session.runner}" not available.`, createMetadata('poke', flags))
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

      await runner.poke(agentSession, args.message)

      if (jsonMode) {
        outputSuccessAsJson({
          id: session.id,
          agentName: session.agentName,
          message: args.message,
          delivered: true,
        }, createMetadata('poke', flags))
        return
      }

      this.log(styles.success(`✓ Message sent to ${session.agentName}`))
    } finally {
      store.close()
    }
  }
}
