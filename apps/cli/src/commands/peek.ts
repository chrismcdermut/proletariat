/**
 * prlt peek <agent> — view agent output (last N lines)
 *
 * Captures recent output from an agent's tmux pane.
 * Works without HQ / PMO.
 */

import { Args, Flags } from '@oclif/core'
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

export default class Peek extends PromptCommand {
  static description = 'View agent output (last N lines from tmux pane)'

  static examples = [
    '<%= config.bin %> peek bold-fox',
    '<%= config.bin %> peek bold-fox --lines 100',
    '<%= config.bin %> peek SES-ABC123',
  ]

  static args = {
    agent: Args.string({
      description: 'Agent name or session ID',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    lines: Flags.integer({
      char: 'l',
      description: 'Number of scrollback lines to capture',
      default: 50,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Peek)
    const jsonMode = shouldOutputJson(flags)

    const store = new SessionStore()
    try {
      store.reconcile()
      const session = store.resolve(args.agent)

      if (!session) {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_FOUND', `No session found for "${args.agent}". Run "prlt ps" to see agents.`, createMetadata('peek', flags))
          return
        }
        this.error(`No session found for "${args.agent}". Run "prlt ps" to see agents.`)
      }

      const runner = getRunner(session.runner)
      if (!runner) {
        if (jsonMode) {
          outputErrorAsJson('RUNNER_NOT_FOUND', `Runner "${session.runner}" not available.`, createMetadata('peek', flags))
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
        status: session.status as 'running' | 'done' | 'error',
      }

      const output = await runner.peek(agentSession, flags.lines)

      if (jsonMode) {
        outputSuccessAsJson({
          id: session.id,
          agentName: session.agentName,
          sessionName: session.sessionName,
          lines: flags.lines,
          content: output,
        }, createMetadata('peek', flags))
        return
      }

      // Raw text output — pipeable and scriptable
      process.stdout.write(output + '\n')
    } finally {
      store.close()
    }
  }
}
