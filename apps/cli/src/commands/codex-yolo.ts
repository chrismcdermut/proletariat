/**
 * prlt codex-yolo <task> — Codex, skip permissions
 *
 * No prompts, no menus, max autonomy.
 * Runs immediately in tmux background.
 * Works anywhere, no HQ required.
 */

import { Args } from '@oclif/core'
import { PromptCommand } from '../lib/prompt-command.js'
import { machineOutputFlags } from '../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { styles } from '../lib/styles.js'
import { getRunner } from '../lib/runners/index.js'
import { SessionStore } from '../lib/session-store.js'
import { generateAgentName } from '../lib/agent-naming.js'

export default class CodexYolo extends PromptCommand {
  static description = 'Launch Codex immediately with max autonomy (no prompts, background)'

  static examples = [
    '<%= config.bin %> codex-yolo "fix the login bug"',
    '<%= config.bin %> codex-yolo "add dark mode support"',
  ]

  static args = {
    task: Args.string({
      description: 'Task description for the agent',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CodexYolo)
    const jsonMode = shouldOutputJson(flags)

    const runner = getRunner('codex')
    if (!runner) {
      if (jsonMode) {
        outputErrorAsJson('RUNNER_NOT_FOUND', 'Codex is not installed or not on PATH.', createMetadata('codex-yolo', flags))
        return
      }
      this.error('Codex is not installed or not on PATH.')
    }

    const workdir = process.cwd()
    const agentName = generateAgentName()

    try {
      const session = await runner.spawn({
        task: args.task,
        workdir,
        runner: 'codex',
        background: true,
      })

      const store = new SessionStore()
      const record = store.create({
        agentName,
        runner: 'codex',
        task: args.task,
        workdir,
        sessionName: session.sessionName,
        environment: 'host',
        permissionMode: 'danger',
      })
      store.close()

      if (jsonMode) {
        outputSuccessAsJson({
          id: record.id,
          agentName,
          runner: 'codex',
          sessionName: session.sessionName,
          task: args.task,
          workdir,
          status: 'running',
        }, createMetadata('codex-yolo', flags))
        return
      }

      this.log(styles.success(`✓ ${agentName} is on it (${record.id})`))
      this.log(styles.muted(`  prlt peek ${agentName}   |   prlt stop ${agentName}`))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', `Failed to spawn agent: ${error instanceof Error ? error.message : error}`, createMetadata('codex-yolo', flags))
        return
      }
      this.error(`Failed to spawn agent: ${error instanceof Error ? error.message : error}`)
    }
  }
}
