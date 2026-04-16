/**
 * prlt watch stop — stop the supervised watch daemon (PRLT-1321).
 *
 * Kills the `prlt-daemon-{hq}-watch` tmux session and marks its machine.db
 * record as stopped. This is the clean counterpart to `prlt watch`, which
 * spawns the daemon; raw `kill <PID>` is no longer needed.
 */

import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  getDaemonStatus,
  stopDaemon,
} from '../../lib/session/daemon-manager.js'

export default class WatchStop extends PromptCommand {
  static description = 'Stop the supervised watch daemon (PRLT-1321)'

  static examples = [
    '<%= config.bin %> watch stop',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WatchStop)
    const jsonMode = shouldOutputJson(flags)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run "prlt new" first.',
          createMetadata('watch stop', flags),
        )
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const hqPath = workspaceInfo.path
    const status = getDaemonStatus(hqPath, 'watch')

    if (!status.alive) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            status: 'not_running',
            sessionName: status.sessionName,
            message: 'Watch daemon is not running.',
          },
          createMetadata('watch stop', flags),
        )
        return
      }
      this.log(styles.muted(`Watch daemon is not running (no session ${status.sessionName}).`))
      return
    }

    const result = stopDaemon(hqPath, 'watch')

    if (jsonMode) {
      outputSuccessAsJson(
        {
          status: 'stopped',
          sessionName: result.sessionName,
          killed: result.stopped,
        },
        createMetadata('watch stop', flags),
      )
      return
    }

    this.log(styles.success(`Watch daemon stopped (session: ${result.sessionName}).`))
  }
}
