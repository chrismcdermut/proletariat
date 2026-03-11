import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findContainerSessionsByPrefix,
  findSessionForExecution,
  captureTmuxPane,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

// =============================================================================
// Types
// =============================================================================

interface ResolvedSession {
  sessionId: string
  ticketId: string
  agentName: string
  environment: 'host' | 'container'
  containerId?: string
}

// =============================================================================
// tmux Helpers
// =============================================================================

/**
 * Send a text message to a tmux session via send-keys.
 * Sends the text first, then Enter separately with a small delay
 * to avoid race conditions where Enter arrives before text is rendered.
 */
function sendMessage(sessionId: string, message: string, containerId?: string): void {
  // Escape single quotes in the message for shell safety
  const escapedMessage = message.replace(/'/g, "'\\''")

  // Send the text first (without Enter), using -l (literal) flag so tmux
  // does not interpret special characters - message is delivered verbatim
  const sendTextCmd = `tmux send-keys -l -t "${sessionId}" '${escapedMessage}'`
  // Then send Enter separately (Enter is a tmux key name, not literal text)
  const sendEnterCmd = `tmux send-keys -t "${sessionId}" Enter`

  if (containerId) {
    execSync(
      `docker exec ${containerId} bash -c '${sendTextCmd}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    )
    // Small delay before sending Enter to avoid race conditions
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(
      `docker exec ${containerId} bash -c '${sendEnterCmd}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    )
  } else {
    execSync(sendTextCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    // Small delay before sending Enter
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(sendEnterCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
  }
}

// =============================================================================
// Command
// =============================================================================

export default class SessionPoke extends PMOCommand {
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
    ...pmoBaseFlags,
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

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
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
        sendMessage(resolved.sessionId, messageLines[0], resolved.containerId)
      } else {
        // For multi-line messages, send the entire text as a single literal
        // to preserve the message structure
        sendMessage(resolved.sessionId, message.trim(), resolved.containerId)
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
        }
        this.log('')
        this.log(styles.error(`tmux session "${resolved.sessionId}" does not exist. The agent may have exited.`))
        this.log(styles.muted('Use `prlt session list` to see running sessions.'))
        this.log('')
        return
      }

      if (errMsg.includes('No such container') || errMsg.includes('is not running')) {
        if (jsonMode) {
          outputErrorAsJson(
            'CONTAINER_NOT_RUNNING',
            `Docker container for agent "${resolved.agentName}" is not running.`,
            createMetadata('session poke', flags),
          )
        }
        this.log('')
        this.log(styles.error(`Docker container for agent "${resolved.agentName}" is not running.`))
        this.log(styles.muted('The container may have stopped. Check with `docker ps`.'))
        this.log('')
        return
      }

      // Generic send failure
      if (jsonMode) {
        outputErrorAsJson(
          'SEND_FAILED',
          `Failed to send message to agent "${resolved.agentName}": ${errMsg}`,
          createMetadata('session poke', flags),
        )
      }
      this.log('')
      this.log(styles.error(`Failed to send message: ${errMsg}`))
      this.log('')
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
              if (matchIdx >= 0) {
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
   * Resolve an agent identifier (name or ticket ID) to a running session.
   * Looks up active executions and matches tmux sessions.
   */
  private resolveAgentSession(
    identifier: string,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedSession | null {
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run from a proletariat HQ directory.',
          createMetadata('session poke', flags),
        )
      }
      this.log('')
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      this.log('')
      return null
    }

    try {
      // Get active executions
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Find matching execution by exact agent name or exact ticket ID
      let match = activeExecutions.find(exec =>
        exec.agentName === identifier || exec.ticketId === identifier,
      )

      // Orchestrator prefix matching: when identifier is "orchestrator",
      // find executions with agentName "orchestrator" or "orchestrator-*"
      if (!match && identifier === 'orchestrator') {
        const orchestratorMatches = activeExecutions.filter(exec =>
          exec.agentName === 'orchestrator' || exec.agentName.startsWith('orchestrator-'),
        )

        if (orchestratorMatches.length === 1) {
          match = orchestratorMatches[0]
        } else if (orchestratorMatches.length > 1) {
          const names = orchestratorMatches.map(e => e.agentName).join(', ')
          if (jsonMode) {
            outputErrorAsJson(
              'MULTIPLE_ORCHESTRATORS',
              `Multiple orchestrators running: ${names}. Specify one directly.`,
              createMetadata('session poke', flags),
            )
          }
          this.log('')
          this.log(styles.error(`Multiple orchestrators running: ${names}. Specify one directly.`))
          this.log('')
          return null
        }
      }

      if (!match) {
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

      return this.resolveSessionForExecution(match, jsonMode, flags)
    } finally {
      db?.close()
    }
  }

  /**
   * Resolve the tmux session for a specific execution record.
   */
  private resolveSessionForExecution(
    exec: { ticketId: string; agentName: string; sessionId?: string; containerId?: string; environment: string },
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedSession | null {
    const isContainer = !!exec.containerId
    let actualSessionId = exec.sessionId
    let containerId = isContainer ? exec.containerId : undefined

    // If sessionId is NULL, try to discover it from tmux
    if (!exec.sessionId) {
      if (isContainer && exec.containerId) {
        const containerTmuxSessions = getContainerTmuxSessionMap()
        const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
        const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
        if (match) {
          actualSessionId = match
          containerId = exec.containerId
        }
      } else {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
        if (match) {
          actualSessionId = match
        }
      }
    }

    if (!actualSessionId) {
      if (jsonMode) {
        outputErrorAsJson(
          'SESSION_NOT_FOUND',
          `Could not find tmux session for agent "${exec.agentName}" (${exec.ticketId}). The session may not have started yet.`,
          createMetadata('session poke', flags),
        )
      }
      this.log('')
      this.log(styles.error(`Could not find tmux session for agent "${exec.agentName}" (${exec.ticketId}).`))
      this.log(styles.muted('The session may not have started yet.'))
      this.log('')
      return null
    }

    return {
      sessionId: actualSessionId,
      ticketId: exec.ticketId,
      agentName: exec.agentName,
      environment: isContainer ? 'container' : 'host',
      containerId,
    }
  }
}
