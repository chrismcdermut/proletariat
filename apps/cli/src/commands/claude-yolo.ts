/**
 * prlt claude-yolo <task> — Claude Code, skip permissions
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

export default class ClaudeYolo extends PromptCommand {
  static description = 'Launch Claude Code immediately with max autonomy (no prompts, background)'

  static examples = [
    '<%= config.bin %> claude-yolo "fix the login bug"',
    '<%= config.bin %> claude-yolo "add dark mode support"',
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
    const { args, flags } = await this.parse(ClaudeYolo)
    const jsonMode = shouldOutputJson(flags)

    const runner = getRunner('claude-code')
    if (!runner) {
      if (jsonMode) {
        outputErrorAsJson('RUNNER_NOT_FOUND', 'Claude Code is not installed or not on PATH.', createMetadata('claude-yolo', flags))
        return
      }
      this.error('Claude Code is not installed or not on PATH.')
    }

    const workdir = process.cwd()
    const agentName = generateAgentName()

    try {
      const session = await runner.spawn({
        task: args.task,
        workdir,
        runner: 'claude-code',
        background: true,
      })

      const store = new SessionStore()
      const record = store.create({
        agentName,
        runner: 'claude-code',
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
          runner: 'claude-code',
          sessionName: session.sessionName,
          task: args.task,
          workdir,
          status: 'running',
        }, createMetadata('claude-yolo', flags))
        return
      }

      this.log(styles.success(`✓ ${agentName} is on it (${record.id})`))
      this.log(styles.muted(`  prlt peek ${agentName}   |   prlt stop ${agentName}`))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', `Failed to spawn agent: ${error instanceof Error ? error.message : error}`, createMetadata('claude-yolo', flags))
        return
      }
      this.error(`Failed to spawn agent: ${error instanceof Error ? error.message : error}`)
    }
  }
}
