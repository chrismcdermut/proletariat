/**
 * EventEmittingRunner — Decorator that wraps any AgentRunner to emit events.
 *
 * Delegates all operations to the wrapped runner and emits corresponding
 * events on the provided EventBus (or the global singleton).
 */

import type { AgentRunner, AgentSession, SpawnConfig } from '../runners/agent-runner.js'
import type { EventBus } from './event-bus.js'
import { getEventBus } from './event-bus.js'

/**
 * Wraps an AgentRunner to emit runtime events on every operation.
 *
 * Usage:
 * ```ts
 * const runner = new ClaudeCodeRunner()
 * const emitting = new EventEmittingRunner(runner)
 * // Now all operations emit events on the global EventBus
 * const session = await emitting.spawn(config)
 * ```
 */
export class EventEmittingRunner implements AgentRunner {
  readonly name: string
  private readonly inner: AgentRunner
  private readonly bus: EventBus

  constructor(inner: AgentRunner, bus?: EventBus) {
    this.inner = inner
    this.name = inner.name
    this.bus = bus ?? getEventBus()
  }

  async spawn(config: SpawnConfig): Promise<AgentSession> {
    try {
      const session = await this.inner.spawn(config)
      this.bus.emit('agent:spawned', {
        sessionId: session.id,
        runner: this.name,
        task: config.task,
        workdir: config.workdir,
        background: config.background ?? false,
        timestamp: new Date(),
      })
      return session
    } catch (err) {
      this.bus.emit('agent:error', {
        sessionId: 'unknown',
        runner: this.name,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date(),
      })
      throw err
    }
  }

  async getStatus(session: AgentSession): Promise<'running' | 'done' | 'error'> {
    const previousStatus = session.status
    const newStatus = await this.inner.getStatus(session)

    if (newStatus !== previousStatus) {
      this.bus.emit('agent:status_change', {
        sessionId: session.id,
        runner: this.name,
        previousStatus,
        newStatus,
        timestamp: new Date(),
      })
    }

    return newStatus
  }

  async peek(session: AgentSession, lines?: number): Promise<string> {
    const output = await this.inner.peek(session, lines)
    this.bus.emit('agent:output', {
      sessionId: session.id,
      runner: this.name,
      output,
      lines: lines ?? 50,
      timestamp: new Date(),
    })
    return output
  }

  async poke(session: AgentSession, message: string): Promise<void> {
    await this.inner.poke(session, message)
    this.bus.emit('agent:poked', {
      sessionId: session.id,
      runner: this.name,
      message,
      timestamp: new Date(),
    })
  }

  async stop(session: AgentSession): Promise<void> {
    await this.inner.stop(session)
    this.bus.emit('agent:stopped', {
      sessionId: session.id,
      runner: this.name,
      reason: 'manual',
      timestamp: new Date(),
    })
  }
}
