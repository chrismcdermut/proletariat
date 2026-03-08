/**
 * Shared logic for spawning agents via Layer 0 commands.
 *
 * Used by: prlt run, prlt claude, prlt codex, prlt claude-yolo, prlt codex-yolo
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { styles } from './styles.js'
import { getRunner } from './runners/index.js'
import type { AgentRunner, SpawnConfig } from './runners/index.js'
import { SessionStore, SessionRecord } from './session-store.js'
import { generateAgentName, buildLayer0SessionName } from './agent-naming.js'

export interface RunAgentOptions {
  task: string
  runnerName: string
  workdir?: string
  permissionMode?: 'danger' | 'safe'
  environment?: 'host' | 'docker' | 'podman'
  detached?: boolean
}

export interface RunAgentResult {
  session: SessionRecord
  agentName: string
  runner: AgentRunner
}

/**
 * Core agent spawning logic.
 * Returns the session record and runner, or throws on failure.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const workdir = options.workdir ? path.resolve(options.workdir) : process.cwd()
  if (!fs.existsSync(workdir)) {
    throw new Error(`Directory not found: ${workdir}`)
  }

  const runner = getRunner(options.runnerName)
  if (!runner) {
    throw new Error(`Runner "${options.runnerName}" not found or binary not on PATH.`)
  }

  const agentName = generateAgentName()
  const sessionName = buildLayer0SessionName(runner.name, agentName)
  const permissionMode = options.permissionMode ?? 'safe'
  const environment = options.environment ?? 'host'

  const spawnConfig: SpawnConfig = {
    task: options.task,
    workdir,
    runner: runner.name,
    background: options.detached,
  }

  const agentSession = await runner.spawn(spawnConfig)

  const store = new SessionStore()
  try {
    const record = store.create({
      agentName,
      runner: runner.name,
      task: options.task,
      workdir,
      sessionName: agentSession.sessionName,
      environment,
      permissionMode,
    })
    return { session: record, agentName, runner }
  } finally {
    store.close()
  }
}

/**
 * Print the post-spawn help message.
 */
export function printSpawnSuccess(log: (msg: string) => void, agentName: string, sessionId: string): void {
  log(styles.success(`✓ Agent spawned: ${agentName} (${sessionId})`))
  log('')
  log(styles.muted('Commands:'))
  log(styles.muted(`  prlt ps                    List running agents`))
  log(styles.muted(`  prlt peek ${agentName}       View output`))
  log(styles.muted(`  prlt poke ${agentName} "msg"  Send message`))
  log(styles.muted(`  prlt stop ${agentName}       Stop agent`))
  log(styles.muted(`  prlt logs ${agentName}       View full logs`))
  log('')
}
