import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import { styles } from '../../lib/styles.js'
import {
  type ResolvedSession,
  captureTmuxPane,
  sendTmuxMessage,
} from '../../lib/execution/session-utils.js'
import {
  collectAllSessions,
  findSessionByIdentifier,
} from '../../lib/session/renderer.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

// =============================================================================
// Command
// =============================================================================

export default class SessionPoke extends PromptCommand {
  static description = 'Send a message to a running agent\'s Claude Code session'

  static examples = [
    '<%= config.bin %> session poke altman "Please focus on the tests first"',
    '<%= config.bin %> session poke TKT-123 "Add error handling for edge cases"',
    '<%= config.bin %> session poke altman --file prompt.md',
    '<%= config.bin %> session poke altman "Run the tests" --wait --timeout 60',
    'echo "multi-line message" | <%= config.bin %> session poke altman -',
  ]

  static args = {
    agent: Args.string({
      description: 'Agent name or ticket ID of the running agent',
      required: true,
    }),
    message: Args.string({
      description: 'Message to send (use "-" to read from stdin, or omit with --file)',
      required: false,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    file: Flags.string({
      char: 'F',
      description: 'Read message from a file (supports multi-line)',
    }),
    wait: Flags.boolean({
      char: 'w',
      description: 'Wait for response after sending (capture output after message is sent)',
      default: false,
    }),
    timeout: Flags.integer({
      description: 'Timeout in seconds for --wait mode',
      default: 120,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionPoke)
    const jsonMode = shouldOutputJson(flags)
    const { agent } = args

    // Resolve the message from args, --file, or stdin
    let message: string
    if (flags.file) {
      try {
        message = fs.readFileSync(flags.file, 'utf-8')
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson(
            'FILE_READ_ERROR',
            `Failed to read file "${flags.file}": ${errMsg}`,
            createMetadata('session poke', flags),
          )
        } else {
          this.log('')
          this.log(styles.error(`Failed to read file "${flags.file}": ${errMsg}`))
          this.log('')
        }
        return
      }
    } else if (args.message === '-') {
      // Read from stdin
      try {
        message = fs.readFileSync(0, 'utf-8')
      } catch {
        if (jsonMode) {
          outputErrorAsJson(
            'STDIN_READ_ERROR',
            'Failed to read from stdin.',
            createMetadata('session poke', flags),
          )
        } else {
          this.log('')
          this.log(styles.error('Failed to read from stdin.'))
          this.log('')
        }
        return
      }
    } else if (args.message) {
      message = args.message
    } else {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_MESSAGE',
          'No message provided. Pass a message argument, use --file, or pipe to stdin with "-".',
          createMetadata('session poke', flags),
        )
      } else {
        this.log('')
        this.log(styles.error('No message provided.'))
        this.log(styles.muted('Usage: prlt session poke <agent> "message"'))
        this.log(styles.muted('       prlt session poke <agent> --file prompt.md'))
        this.log(styles.muted('       echo "msg" | prlt session poke <agent> -'))
        this.log('')
      }
      return
    }

    // Resolve the agent's active session
    const resolved = this.resolveAgentSession(agent, jsonMode, flags)
    if (!resolved) return

    // Capture pre-send content for --wait mode
    let preSendContent: string | null = null
    if (flags.wait) {
      preSendContent = captureTmuxPane(resolved.sessionId, 200, resolved.containerId)
    }

    // Send the message (split multi-line into individual sends)
    try {
      const messageLines = message.trim().split('\n')
      if (messageLines.length === 1) {
        sendTmuxMessage(resolved.sessionId, messageLines[0], resolved.containerId)
      } else {
        // For multi-line messages, send the entire text as a single literal
        // to preserve the message structure
        sendTmuxMessage(resolved.sessionId, message.trim(), resolved.containerId)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)

      // Check for specific container/session errors
      if (errMsg.includes('no server running') || errMsg.includes('session not found') || errMsg.includes("can't find session")) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `tmux session "${resolved.sessionId}" does not exist. The agent may have exited.`,
            createMetadata('session poke', flags),
          )
        } else {
          this.log('')
          this.log(styles.error(`tmux session "${resolved.sessionId}" does not exist. The agent may have exited.`))
          this.log(styles.muted('Use `prlt session list` to see running sessions.'))
          this.log('')
        }
        return
      }

      if (errMsg.includes('No such container') || errMsg.includes('is not running')) {
        if (jsonMode) {
          outputErrorAsJson(
            'CONTAINER_NOT_RUNNING',
            `Docker container for agent "${resolved.agentName}" is not running.`,
            createMetadata('session poke', flags),
          )
        } else {
          this.log('')
          this.log(styles.error(`Docker container for agent "${resolved.agentName}" is not running.`))
          this.log(styles.muted('The container may have stopped. Check with `docker ps`.'))
          this.log('')
        }
        return
      }

      // Generic send failure
      if (jsonMode) {
        outputErrorAsJson(
          'SEND_FAILED',
          `Failed to send message to agent "${resolved.agentName}": ${errMsg}`,
          createMetadata('session poke', flags),
        )
      } else {
        this.log('')
        this.log(styles.error(`Failed to send message: ${errMsg}`))
        this.log('')
      }
      return
    }

    // Handle --wait mode: capture output after sending
    let responseContent: string | null = null
    if (flags.wait) {
      const timeoutMs = flags.timeout * 1000
      const startTime = Date.now()

      // Wait briefly for the agent to start processing
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Poll for new output until timeout
      while (Date.now() - startTime < timeoutMs) {
        const currentContent = captureTmuxPane(resolved.sessionId, 200, resolved.containerId)
        if (currentContent && currentContent !== preSendContent) {
          // Check if the agent appears to be done (idle/prompt visible)
          const lines = currentContent.split('\n')
          const lastNonEmpty = [...lines].reverse().find(l => l.trim().length > 0) || ''
          const atPrompt = /[$❯#>]\s*$/.test(lastNonEmpty)
          const isDone = /agent work complete/i.test(lastNonEmpty)
          const isWorking = /esc to interrupt/i.test(currentContent.split('\n').slice(-5).join('\n'))

          // If agent is idle or done, capture the response
          if (atPrompt || isDone || !isWorking) {
            // Get just the new lines since we sent the message
            if (preSendContent) {
              const preLines = preSendContent.split('\n')
              const curLines = currentContent.split('\n')
              const lastPreLine = preLines[preLines.length - 1]
              const matchIdx = curLines.lastIndexOf(lastPreLine)
              if (matchIdx !== -1) {
                responseContent = curLines.slice(matchIdx + 1).join('\n')
              } else {
                responseContent = currentContent
              }
            } else {
              responseContent = currentContent
            }
            break
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      if (responseContent === null) {
        responseContent = '[Timeout: no response captured within ' + flags.timeout + ' seconds]'
      }
    }

    // Output result
    if (jsonMode) {
      outputSuccessAsJson({
        success: true,
        agent: resolved.agentName,
        session: resolved.sessionId,
        message: message.trim(),
        ...(flags.wait ? { response: responseContent } : {}),
      }, createMetadata('session poke', flags))
    }

    this.log('')
    this.log(styles.success(`Message sent to ${resolved.agentName} (${resolved.ticketId})`))
    if (flags.wait && responseContent) {
      this.log('')
      this.log(styles.info('Response:'))
      this.log(responseContent)
    }
    this.log('')
  }

  /**
   * Resolve an agent identifier (name, ticket ID, or tmux session name) to a
   * running session.
   *
   * PRLT-1323: Uses the unified machine-wide session collection so this works
   * for workers, orchestrators, AND daemons — any running tmux pane with a
   * tracked record (workspace.db, machine.db, or tmux/Docker discovery) is
   * reachable by identifier. No "active execution" row is required.
   */
  private resolveAgentSession(
    identifier: string,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedSession | null {
    // Collect every known session on the machine — across all registered HQs,
    // machine.db, and discovered tmux/Docker sessions (orchestrators, daemons).
    // includeAll: true so stale DB records are still considered; the helper
    // prefers alive sessions and only falls back to stale rows when no live
    // match exists (so tmux-level failures surface clearly to the caller).
    const sessions = collectAllSessions({ includeAll: true })
    const result = findSessionByIdentifier(sessions, identifier)

    if (result.kind === 'none') {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_ACTIVE_EXECUTION',
          `Agent "${identifier}" has no active session. Use \`prlt session list\` to see running sessions.`,
          createMetadata('session poke', flags),
        )
      }
      this.log('')
      this.log(styles.error(`Agent "${identifier}" has no active session.`))
      this.log(styles.muted('Use `prlt session list` to see running sessions.'))
      this.log('')
      return null
    }

    if (result.kind === 'multiple') {
      const names = result.candidates.map(c => c.agentName).join(', ')
      if (jsonMode) {
        outputErrorAsJson(
          'MULTIPLE_MATCHES',
          `Multiple sessions match "${identifier}": ${names}. Specify one directly.`,
          createMetadata('session poke', flags),
        )
      }
      this.log('')
      this.log(styles.error(`Multiple sessions match "${identifier}": ${names}.`))
      this.log(styles.muted('Specify the full agent name to disambiguate.'))
      this.log('')
      return null
    }

    const match = result.session
    return {
      sessionId: match.sessionId,
      ticketId: match.ticketId,
      agentName: match.agentName,
      environment: match.environment,
      containerId: match.containerId,
    }
  }
}
