import { Flags } from '@oclif/core'
import { fork } from 'node:child_process'
import * as path from 'node:path'
import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  isDaemonRunning,
  getDaemonInfo,
  writeDaemonInfo,
  getDaemonLogPath,
} from '../../lib/sync/daemon.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncStart extends RuntimeCommand {
  static description = 'Start the board sync daemon'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --interval 30',
  ]

  static flags = {
    ...runtimeBaseFlags,
    interval: Flags.integer({
      char: 'i',
      description: 'Poll interval in seconds',
      default: 60,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncStart)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)

    // Check if already running
    if (isDaemonRunning(hqPath)) {
      const info = getDaemonInfo(hqPath)
      if (jsonMode) {
        outputErrorAsJson('ALREADY_RUNNING', `Daemon already running (PID ${info?.pid})`, createMetadata('sync start', flags))
        return
      }
      this.log(styles.warning(`Sync daemon already running (PID ${info?.pid})`))
      return
    }

    const interval = flags.interval

    // Spawn a detached child process that runs the sync loop
    const daemonScript = path.join(import.meta.dirname, '..', '..', 'lib', 'sync', 'daemon-process.js')
    const logPath = getDaemonLogPath(hqPath)

    const child = fork(daemonScript, [hqPath, String(interval)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })

    child.unref()

    if (!child.pid) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', 'Failed to spawn daemon process', createMetadata('sync start', flags))
        return
      }
      this.error('Failed to spawn daemon process')
      return
    }

    // Write PID file
    writeDaemonInfo(hqPath, {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      intervalSeconds: interval,
    })

    if (jsonMode) {
      outputSuccessAsJson({
        pid: child.pid,
        interval,
        logPath,
      }, createMetadata('sync start', flags))
      return
    }

    this.log(styles.success(`Sync daemon started (PID ${child.pid})`))
    this.log(`  Interval: every ${interval}s`)
    this.log(`  Log: ${logPath}`)
  }
}
