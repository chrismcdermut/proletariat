/**
 * prlt ps — list running agents
 *
 * Shows all tracked agent sessions across all repos.
 * Reads from global session store (~/.proletariat/sessions.db).
 * Works without HQ / PMO.
 */

import { Flags } from '@oclif/core'
import { PromptCommand } from '../lib/prompt-command.js'
import { machineOutputFlags } from '../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { styles } from '../lib/styles.js'
import { SessionStore } from '../lib/session-store.js'

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length)
}

export default class Ps extends PromptCommand {
  static description = 'List running agents (works anywhere, no HQ required)'

  static examples = [
    '<%= config.bin %> ps',
    '<%= config.bin %> ps --all',
    '<%= config.bin %> ps --json',
  ]

  static flags = {
    ...machineOutputFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all sessions including completed',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Ps)
    const jsonMode = shouldOutputJson(flags)

    const store = new SessionStore()

    try {
      // Reconcile with tmux to update stale sessions
      store.reconcile()

      const sessions = flags.all ? store.list() : store.list('running')

      if (jsonMode) {
        outputSuccessAsJson({
          sessions: sessions.map(s => ({
            id: s.id,
            agentName: s.agentName,
            runner: s.runner,
            task: s.task,
            workdir: s.workdir,
            environment: s.environment,
            permissionMode: s.permissionMode,
            status: s.status,
            duration: s.status === 'running' ? Date.now() - s.startedAt.getTime() : undefined,
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt?.toISOString(),
          })),
        }, createMetadata('ps', flags))
        return
      }

      if (sessions.length === 0) {
        this.log('')
        this.log(styles.muted('No running agents.'))
        this.log('')
        this.log(styles.muted('Start one with: prlt run "your task"'))
        this.log('')
        return
      }

      this.log('')
      this.log(styles.header('🤖 Agents'))
      this.log('═'.repeat(100))

      // Header
      this.log(
        styles.muted(
          '  ' +
          padEnd('Agent', 16) +
          padEnd('Runner', 14) +
          padEnd('Task', 30) +
          padEnd('Env', 8) +
          padEnd('Duration', 12) +
          'Status'
        )
      )
      this.log('  ' + '─'.repeat(98))

      for (const session of sessions) {
        const duration = session.status === 'running'
          ? formatDuration(Date.now() - session.startedAt.getTime())
          : formatDuration((session.endedAt?.getTime() ?? Date.now()) - session.startedAt.getTime())

        const statusColor =
          session.status === 'running' ? styles.success :
          session.status === 'done' ? styles.muted :
          session.status === 'stopped' ? styles.warning :
          styles.error

        const taskDisplay = session.task.length > 28
          ? session.task.substring(0, 25) + '...'
          : session.task

        this.log(
          '  ' +
          padEnd(session.agentName, 16) +
          padEnd(session.runner, 14) +
          padEnd(taskDisplay, 30) +
          padEnd(session.environment, 8) +
          padEnd(duration, 12) +
          statusColor(session.status)
        )
      }

      this.log('')
      this.log('═'.repeat(100))

      const running = sessions.filter(s => s.status === 'running')
      if (running.length > 0) {
        const first = running[0]
        this.log(styles.muted('\nCommands:'))
        this.log(styles.muted(`  prlt peek ${first.agentName}        View output`))
        this.log(styles.muted(`  prlt stop ${first.agentName}        Stop agent`))
        this.log('')
      }
    } finally {
      store.close()
    }
  }
}
