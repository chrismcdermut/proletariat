import { Flags } from '@oclif/core'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { SessionWatcher } from '../../lib/session/watcher.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { onShutdown } from '../../lib/signal-handler.js'

export default class SessionWatch extends PromptCommand {
  static description = 'Watch agent sessions for heartbeat timeouts and auto-terminate stale agents'

  static examples = [
    '<%= config.bin %> session watch',
    '<%= config.bin %> session watch --interval 3 --timeout 10',
    '<%= config.bin %> session watch --no-kill',
    '<%= config.bin %> session watch --once',
  ]

  static flags = {
    ...machineOutputFlags,
    interval: Flags.integer({
      description: 'Poll interval in minutes',
      default: 5,
    }),
    timeout: Flags.integer({
      description: 'Heartbeat timeout in minutes before marking agent as stale',
      default: 15,
    }),
    kill: Flags.boolean({
      description: 'Auto-kill containers for stale agents',
      default: true,
      allowNo: true,
    }),
    once: Flags.boolean({
      description: 'Run a single check and exit (no polling loop)',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionWatch)
    const jsonMode = shouldOutputJson(flags)

    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      db = openWorkspaceDatabase(workspaceInfo.path)
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run from a proletariat HQ directory.',
          createMetadata('session watch', flags),
        )
        return
      }
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      return
    }

    const log = (msg: string) => {
      if (!jsonMode) {
        const timestamp = new Date().toLocaleTimeString()
        this.log(styles.muted(`[${timestamp}]`) + ' ' + msg)
      }
    }

    const watcher = new SessionWatcher({
      db,
      intervalMinutes: flags.interval,
      timeoutMinutes: flags.timeout,
      autoKill: flags.kill,
      log,
      onStaleDetected: async (exec, reason) => {
        if (!jsonMode) {
          this.log(
            styles.error(`  STALE: ${exec.agentName} (${exec.ticketId}) — ${reason}`)
          )
        }
      },
    })

    if (flags.once) {
      // Single check mode
      const result = await watcher.runCycle()

      if (jsonMode) {
        outputSuccessAsJson({
          checked: result.checked,
          heartbeatsUpdated: result.heartbeatsUpdated,
          staleExecutions: result.staleExecutions.map(s => ({
            executionId: s.execution.id,
            ticketId: s.execution.ticketId,
            agentName: s.execution.agentName,
            containerId: s.execution.containerId,
            staleDurationMinutes: s.staleDurationMinutes,
            reason: s.reason,
          })),
          containersKilled: result.containersKilled,
        }, createMetadata('session watch', flags))
      } else {
        this.log('')
        this.log(styles.header('Session Watch — Single Check'))
        this.log('═'.repeat(60))
        this.log(`  Executions checked:    ${result.checked}`)
        this.log(`  Heartbeats updated:    ${result.heartbeatsUpdated}`)
        this.log(`  Stale agents detected: ${result.staleExecutions.length}`)
        this.log(`  Containers killed:     ${result.containersKilled}`)

        if (result.staleExecutions.length > 0) {
          this.log('')
          this.log(styles.warning('  Stale Agents:'))
          for (const stale of result.staleExecutions) {
            this.log(styles.error(
              `    ${stale.execution.agentName} (${stale.execution.ticketId}) — ${stale.reason}`
            ))
          }
        } else {
          this.log('')
          this.log(styles.success('  All agents healthy.'))
        }
        this.log('')
      }

      db?.close()
      return
    }

    // Continuous watch mode
    if (!jsonMode) {
      this.log('')
      this.log(styles.header('Session Watcher'))
      this.log('═'.repeat(60))
      this.log(`  Poll interval:      ${flags.interval} minute(s)`)
      this.log(`  Heartbeat timeout:  ${flags.timeout} minute(s)`)
      this.log(`  Auto-kill:          ${flags.kill ? 'enabled' : 'disabled'}`)
      this.log(styles.muted('  Press Ctrl+C to stop'))
      this.log('')
    }

    watcher.start()

    // Wait for shutdown signal
    await new Promise<void>((resolve) => {
      onShutdown(() => {
        watcher.stop()
        db?.close()
        resolve()
      })
    })
  }
}
