import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getHostTmuxSessionNames } from '../../lib/execution/session-utils.js'
import { ORCHESTRATOR_SESSION_NAME } from './start.js'

export default class OrchestratorAttach extends PromptCommand {
  static description = 'Attach to the running orchestrator tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --current-terminal',
  ]

  static flags = {
    ...machineOutputFlags,
    'current-terminal': Flags.boolean({
      char: 'c',
      description: 'Attach in current terminal instead of new tab',
      default: false,
    }),
    terminal: Flags.string({
      char: 't',
      description: 'Terminal app to use (iTerm, Terminal, Ghostty)',
      default: 'iTerm',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestratorAttach)
    const jsonMode = shouldOutputJson(flags)

    // Check if orchestrator session exists
    const hostSessions = getHostTmuxSessionNames()
    if (!hostSessions.includes(ORCHESTRATOR_SESSION_NAME)) {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_RUNNING',
          'Orchestrator is not running. Start it with: prlt orchestrator start',
          createMetadata('orchestrator attach', flags),
        )
        return
      }
      this.log('')
      this.log(styles.warning('Orchestrator is not running.'))
      this.log(styles.muted('Start it with: prlt orchestrator start'))
      this.log('')
      return
    }

    if (jsonMode) {
      outputSuccessAsJson({
        sessionId: ORCHESTRATOR_SESSION_NAME,
        status: 'attaching',
      }, createMetadata('orchestrator attach', flags as Record<string, unknown>))
      return
    }

    this.log('')
    this.log(styles.info(`Attaching to orchestrator session: ${ORCHESTRATOR_SESSION_NAME}`))

    if (flags['current-terminal']) {
      try {
        execSync(`tmux attach -t "${ORCHESTRATOR_SESSION_NAME}"`, { stdio: 'inherit' })
      } catch {
        this.error(`Failed to attach to orchestrator session "${ORCHESTRATOR_SESSION_NAME}"`)
      }
    } else {
      await this.openInNewTab(flags.terminal)
    }
  }

  private async openInNewTab(terminalApp: string): Promise<void> {
    const title = 'Orchestrator'
    const attachCmd = `tmux attach -t "${ORCHESTRATOR_SESSION_NAME}"`

    const baseDir = path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `attach-orch-${Date.now()}.sh`)

    const script = `#!/bin/bash
# Set terminal tab title
echo -ne "\\033]0;${title}\\007"
echo -ne "\\033]1;${title}\\007"

echo "Attaching to: ${ORCHESTRATOR_SESSION_NAME}"
${attachCmd}

# Clean up
rm -f "${scriptPath}"
exec $SHELL
`
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })

    try {
      switch (terminalApp) {
        case 'iTerm':
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              tell current window
                set newTab to (create tab with default profile)
                tell current session of newTab
                  set name to "${title}"
                  write text "${scriptPath}"
                end tell
              end tell
            end tell
          '`)
          break

        case 'Ghostty':
          execSync(`osascript -e '
            tell application "Ghostty"
              activate
            end tell
            tell application "System Events"
              tell process "Ghostty"
                keystroke "t" using command down
                delay 0.3
                keystroke "${scriptPath}"
                keystroke return
              end tell
            end tell
          '`)
          break

        case 'Terminal':
        default:
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${scriptPath}" in front window
            end tell
          '`)
          break
      }

      this.log(styles.success('Opened new tab and attaching to orchestrator'))
    } catch (error) {
      this.error(`Failed to open terminal tab: ${error instanceof Error ? error.message : error}`)
    }
  }
}
