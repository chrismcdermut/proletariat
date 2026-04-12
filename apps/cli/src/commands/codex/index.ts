/**
 * prlt codex <task> — Codex with interactive menu
 *
 * Same menu flow as `prlt claude` but uses the Codex runner.
 * Prompts for: working directory, permission mode, environment.
 * Works anywhere, no HQ required.
 */

import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { getRunner } from '../../lib/runners/index.js'
import { SessionStore } from '../../lib/session-store.js'
import { generateAgentName } from '../../lib/agent-naming.js'

export default class Codex extends PromptCommand {
  static description = 'Quick launch Codex for ad-hoc sessions (works anywhere, no HQ required)'

  static examples = [
    '<%= config.bin %> codex "fix the bug"',
    '<%= config.bin %> codex "add dark mode" --permission-mode danger',
    '<%= config.bin %> codex "add tests" --directory ./my-project',
  ]

  static args = {
    task: Args.string({
      description: 'Task description for the agent',
      required: false,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    'permission-mode': Flags.string({
      char: 'p',
      description: 'Permission mode (danger: skip prompts, safe: require approval)',
      options: ['danger', 'safe'],
    }),
    directory: Flags.string({
      description: 'Directory to run in (default: cwd)',
    }),
    detached: Flags.boolean({
      char: 'd',
      description: 'Run in background (detached)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Codex)
    const jsonMode = shouldOutputJson(flags)
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'codex' } : null

    // Check if codex is available
    const runner = getRunner('codex')
    if (!runner) {
      if (jsonMode) {
        outputErrorAsJson('RUNNER_NOT_FOUND', 'Codex is not installed or not on PATH. Install with: npm install -g @openai/codex', createMetadata('codex', flags))
        return
      }
      this.error('Codex is not installed or not on PATH. Install with: npm install -g @openai/codex')
    }

    // Determine working directory
    const workdir = flags.directory ? path.resolve(flags.directory) : process.cwd()
    if (!fs.existsSync(workdir)) {
      if (jsonMode) {
        outputErrorAsJson('DIRECTORY_NOT_FOUND', `Directory not found: ${workdir}`, createMetadata('codex', flags))
        return
      }
      this.error(`Directory not found: ${workdir}`)
    }

    // Get task from args or prompt
    let task = args.task
    if (!task) {
      const { inputTask } = await this.prompt<{ inputTask: string }>([
        {
          type: 'input',
          name: 'inputTask',
          message: 'What should the agent work on?',
          validate: (input: unknown) => (input as string).trim() ? true : 'Task description required',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      task = inputTask.trim()
    }

    // Prompt for permission mode
    let permissionMode: 'danger' | 'safe' = 'safe'
    if (flags['permission-mode']) {
      permissionMode = flags['permission-mode'] as 'danger' | 'safe'
    } else if (!flags.detached) {
      const { selectedMode } = await this.prompt<{ selectedMode: string }>([
        {
          type: 'list',
          name: 'selectedMode',
          message: 'Permission mode:',
          choices: [
            { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: `prlt codex --permission-mode danger "${task}" --json` },
            { name: '🔒 safe   - Require approval for dangerous ops', value: 'safe', command: `prlt codex --permission-mode safe "${task}" --json` },
          ],
          default: 'danger',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      permissionMode = selectedMode as 'danger' | 'safe'
    } else {
      permissionMode = 'danger'
    }

    const agentName = generateAgentName()

    // Show summary
    if (!jsonMode) {
      this.log('')
      this.log(styles.header('🚀 Spawning Codex Agent'))
      this.log('')
      this.log(styles.muted(`   Agent:       ${agentName}`))
      this.log(styles.muted(`   Task:        ${task!.substring(0, 60)}${task!.length > 60 ? '...' : ''}`))
      this.log(styles.muted(`   Directory:   ${workdir}`))
      this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
      this.log('')
    }

    try {
      const session = await runner.spawn({
        task: task!,
        workdir,
        runner: 'codex',
        background: flags.detached,
      })

      const store = new SessionStore()
      const record = store.create({
        agentName,
        runner: 'codex',
        task: task!,
        workdir,
        sessionName: session.sessionName,
        environment: 'host',
        permissionMode,
      })
      store.close()

      if (jsonMode) {
        outputSuccessAsJson({
          id: record.id,
          agentName,
          runner: 'codex',
          sessionName: session.sessionName,
          task: task!,
          workdir,
          status: 'running',
        }, createMetadata('codex', flags))
        return
      }

      this.log(styles.success(`✓ Agent spawned: ${agentName} (${record.id})`))
      this.log('')
      this.log(styles.muted('Commands:'))
      this.log(styles.muted(`  prlt ps                    List running agents`))
      this.log(styles.muted(`  prlt peek ${agentName}       View output`))
      this.log(styles.muted(`  prlt stop ${agentName}       Stop agent`))
      this.log('')
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', `Failed to spawn agent: ${error instanceof Error ? error.message : error}`, createMetadata('codex', flags))
        return
      }
      this.error(`Failed to spawn agent: ${error instanceof Error ? error.message : error}`)
    }
  }
}
