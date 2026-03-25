/**
 * ClaudeCodeRunner
 *
 * AgentRunner implementation for Claude Code.
 * Wraps the existing runHost() execution logic from execution/runners.ts
 * to provide a pluggable runner interface while maintaining full backward
 * compatibility with `prlt work start`.
 */

import { execSync, execFileSync } from 'node:child_process'
import type { AgentRunner, AgentSession, SpawnConfig } from './agent-runner.js'
import {
  runHost,
  buildSessionName,
} from '../execution/runners.js'
import { DEFAULT_EXECUTION_CONFIG } from '../execution/types.js'
import type { ExecutionContext, ExecutionConfig } from '../execution/types.js'
import { captureTmuxPane } from '../execution/session-utils.js'

/**
 * Claude Code agent runner.
 *
 * Delegates to the existing runHost() function for spawning, which handles:
 * - tmux session creation for persistence
 * - Terminal tab opening (iTerm, Terminal.app, Ghostty, etc.)
 * - Prompt building and script generation
 * - Permission mode and output mode configuration
 *
 * The peek/poke/stop methods use tmux commands directly since Claude Code
 * sessions always run inside tmux.
 */
export class ClaudeCodeRunner implements AgentRunner {
  readonly name = 'claude-code'

  async spawn(config: SpawnConfig): Promise<AgentSession> {
    const sessionName = this.buildSessionName(config)
    const context = this.buildExecutionContext(config, sessionName)
    const executionConfig = this.buildExecutionConfig(config)

    const result = await runHost(
      context,
      'claude-code',
      executionConfig,
      config.background ? 'background' : 'terminal',
    )

    if (!result.success) {
      throw new Error(result.error || 'Failed to spawn Claude Code session')
    }

    return {
      id: result.sessionId || sessionName,
      runner: this.name,
      sessionName: result.sessionId || sessionName,
      task: config.task,
      workdir: config.workdir,
      startedAt: new Date(),
      status: 'running',
    }
  }

  async getStatus(session: AgentSession): Promise<'running' | 'done' | 'error'> {
    try {
      const output = execSync(
        `tmux has-session -t "${session.sessionName}" 2>/dev/null && echo "exists"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      ).trim()

      if (output === 'exists') {
        return 'running'
      }
      return 'done'
    } catch {
      // tmux session doesn't exist — agent has finished or was killed
      return 'done'
    }
  }

  async peek(session: AgentSession, lines: number = 50): Promise<string> {
    const output = captureTmuxPane(session.sessionName, lines)
    return output ?? ''
  }

  async poke(session: AgentSession, message: string): Promise<void> {
    try {
      // Send Escape first to clear any buffered input in the prompt —
      // without this, text already typed by the agent concatenates with
      // our message, producing garbage.
      execFileSync('tmux', ['send-keys', '-t', session.sessionName, 'Escape'], {
        stdio: 'pipe',
      })
      // Wait for Escape to take effect before sending new text
      await new Promise(resolve => setTimeout(resolve, 200))
      // Send the message as literal text — uses execFileSync (no shell) so
      // parentheses, quotes, newlines, $, backticks, etc. are all safe.
      execFileSync('tmux', ['send-keys', '-l', '-t', session.sessionName, message], {
        stdio: 'pipe',
      })
      // Send Enter separately (Enter is a tmux key name, not literal text)
      execFileSync('tmux', ['send-keys', '-t', session.sessionName, 'Enter'], {
        stdio: 'pipe',
      })
    } catch (error) {
      throw new Error(
        `Failed to send message to session "${session.sessionName}": ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  }

  async stop(session: AgentSession): Promise<void> {
    try {
      // Send C-c first to gracefully interrupt the running process
      execSync(`tmux send-keys -t "${session.sessionName}" C-c`, { stdio: 'pipe' })
      // Brief delay to let the process handle the signal
      await new Promise(resolve => setTimeout(resolve, 500))
      // Kill the tmux session
      execSync(`tmux kill-session -t "${session.sessionName}"`, { stdio: 'pipe' })
    } catch {
      // Session may already be dead — that's fine
    }
  }

  /**
   * Build a tmux session name from spawn config.
   * Uses the same naming convention as the existing system:
   * "{ticketId}-{action}-{agentName}" or falls back to a generated name.
   */
  private buildSessionName(config: SpawnConfig): string {
    // If we have a full ExecutionContext-like task with ticket info, use buildSessionName
    // Otherwise generate a simple name from the runner and timestamp
    return `claude-${Date.now()}`
  }

  /**
   * Build an ExecutionContext from SpawnConfig.
   * Maps the simplified SpawnConfig to the richer ExecutionContext used by runHost().
   */
  private buildExecutionContext(config: SpawnConfig, sessionName: string): ExecutionContext {
    return {
      ticketId: sessionName,
      ticketTitle: config.task.slice(0, 80),
      ticketDescription: config.task,
      agentName: 'agent',
      agentDir: config.workdir,
      worktreePath: config.workdir,
      branch: 'main',
      createPR: config.createPR,
      actionName: 'work',
      actionPrompt: config.task,
    }
  }

  /**
   * Build ExecutionConfig from SpawnConfig defaults.
   */
  private buildExecutionConfig(config: SpawnConfig): ExecutionConfig {
    return {
      ...DEFAULT_EXECUTION_CONFIG,
      permissionMode: 'danger',
    }
  }
}

/**
 * Create a ClaudeCodeRunner that uses a full ExecutionContext and config.
 *
 * This is the integration point for `prlt work start` — it provides a way
 * to spawn Claude Code using the existing rich context while still going
 * through the AgentRunner interface.
 */
export function createClaudeCodeSession(
  context: ExecutionContext,
  config: ExecutionConfig = DEFAULT_EXECUTION_CONFIG,
  displayMode: 'terminal' | 'background' | 'foreground' = 'terminal',
) {
  return runHost(context, 'claude-code', config, displayMode)
}
