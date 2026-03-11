/**
 * CodexRunner
 *
 * AgentRunner implementation for OpenAI Codex.
 * Wraps the existing runHost() execution logic from execution/runners.ts
 * to provide a pluggable runner interface.
 */

import { execSync } from 'node:child_process'
import type { AgentRunner, AgentSession, SpawnConfig } from './agent-runner.js'
import { runHost } from '../execution/runners.js'
import { DEFAULT_EXECUTION_CONFIG } from '../execution/types.js'
import type { ExecutionContext, ExecutionConfig } from '../execution/types.js'
import { captureTmuxPane } from '../execution/session-utils.js'

export class CodexRunner implements AgentRunner {
  readonly name = 'codex'

  async spawn(config: SpawnConfig): Promise<AgentSession> {
    const sessionName = `codex-${Date.now()}`
    const context = this.buildExecutionContext(config, sessionName)
    const executionConfig = this.buildExecutionConfig()

    const result = await runHost(
      context,
      'codex',
      executionConfig,
      config.background ? 'background' : 'terminal',
    )

    if (!result.success) {
      throw new Error(result.error || 'Failed to spawn Codex session')
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
      return 'done'
    }
  }

  async peek(session: AgentSession, lines: number = 50): Promise<string> {
    const output = captureTmuxPane(session.sessionName, lines)
    return output ?? ''
  }

  async poke(session: AgentSession, message: string): Promise<void> {
    try {
      execSync(
        `tmux send-keys -t "${session.sessionName}" ${JSON.stringify(message)} Enter`,
        { stdio: 'pipe' },
      )
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
      execSync(`tmux send-keys -t "${session.sessionName}" C-c`, { stdio: 'pipe' })
      await new Promise(resolve => setTimeout(resolve, 500))
      execSync(`tmux kill-session -t "${session.sessionName}"`, { stdio: 'pipe' })
    } catch {
      // Session may already be dead
    }
  }

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

  private buildExecutionConfig(): ExecutionConfig {
    return {
      ...DEFAULT_EXECUTION_CONFIG,
      permissionMode: 'danger',
    }
  }
}
