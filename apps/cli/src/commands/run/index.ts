/**
 * prlt run <task> — spawn an agent (generic)
 *
 * Works in any git repo, no HQ required.
 * If no --runner flag, shows menu of available runners.
 * Interactive prompts for working dir, permission mode, environment.
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
import { getAvailableRunners, getRunner } from '../../lib/runners/index.js'
import type { AgentRunner, SpawnConfig } from '../../lib/runners/index.js'
import { SessionStore } from '../../lib/session-store.js'
import { generateAgentName, buildLayer0SessionName } from '../../lib/agent-naming.js'

export default class Run extends PromptCommand {
  static description = 'Spawn an agent to work on a task (works anywhere, no HQ required)'

  static examples = [
    '<%= config.bin %> run "fix the login bug"',
    '<%= config.bin %> run --runner claude-code "add dark mode"',
    '<%= config.bin %> run -d "fix the bug"',
    '<%= config.bin %> run --runner codex "add tests"',
  ]

  static args = {
    task: Args.string({
      description: 'Task description for the agent',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    runner: Flags.string({
      char: 'r',
      description: 'Runner to use (claude-code, codex, pi)',
    }),
    detached: Flags.boolean({
      char: 'd',
      description: 'Run in background (detached)',
      default: false,
    }),
    directory: Flags.string({
      description: 'Working directory (default: cwd)',
    }),
    'permission-mode': Flags.string({
      char: 'p',
      description: 'Permission mode (danger: skip prompts, safe: require approval)',
      options: ['danger', 'safe'],
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Environment to run in',
      options: ['host', 'docker', 'podman'],
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Run)
    const jsonMode = shouldOutputJson(flags)
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'run' } : null

    // Determine working directory
    const workdir = flags.directory ? path.resolve(flags.directory) : process.cwd()
    if (!fs.existsSync(workdir)) {
      if (jsonMode) {
        outputErrorAsJson('DIRECTORY_NOT_FOUND', `Directory not found: ${workdir}`, createMetadata('run', flags))
        return
      }
      this.error(`Directory not found: ${workdir}`)
    }

    // Select runner
    let runner: AgentRunner | null = null

    if (flags.runner) {
      runner = getRunner(flags.runner)
      if (!runner) {
        if (jsonMode) {
          outputErrorAsJson('RUNNER_NOT_FOUND', `Runner "${flags.runner}" not found or binary not on PATH.`, createMetadata('run', flags))
          return
        }
        this.error(`Runner "${flags.runner}" not found or binary not on PATH.`)
      }
    } else {
      // Show menu of available runners
      const available = getAvailableRunners()
      if (available.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_RUNNERS', 'No agent runners found on PATH. Install claude or codex.', createMetadata('run', flags))
          return
        }
        this.error('No agent runners found on PATH. Install claude or codex.')
      }

      if (available.length === 1) {
        runner = available[0]
      } else {
        const { selectedRunner } = await this.prompt<{ selectedRunner: string }>([
          {
            type: 'list',
            name: 'selectedRunner',
            message: 'Select a runner:',
            choices: available.map(r => ({
              name: r.name,
              value: r.name,
              command: `prlt run --runner ${r.name} "${args.task}" --json`,
            })),
          },
        ], jsonModeConfig)
        if (jsonMode) return
        runner = getRunner(selectedRunner)!
      }
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
            { name: '⚠️  danger - Skip permission checks (faster)', value: 'danger', command: `prlt run --runner ${runner!.name} --permission-mode danger "${args.task}" --json` },
            { name: '🔒 safe   - Require approval for dangerous ops', value: 'safe', command: `prlt run --runner ${runner!.name} --permission-mode safe "${args.task}" --json` },
          ],
          default: 'danger',
        },
      ], jsonModeConfig)
      if (jsonMode) return
      permissionMode = selectedMode as 'danger' | 'safe'
    } else {
      // Detached defaults to danger
      permissionMode = 'danger'
    }

    // Environment (default host for now)
    const environment = (flags.environment || 'host') as 'host' | 'docker' | 'podman'

    // Generate agent name and session name
    const agentName = generateAgentName()
    const _sessionName = buildLayer0SessionName(runner!.name, agentName)

    // Show summary
    if (!jsonMode) {
      this.log('')
      this.log(styles.header('🚀 Spawning Agent'))
      this.log('')
      this.log(styles.muted(`   Agent:       ${agentName}`))
      this.log(styles.muted(`   Runner:      ${runner!.name}`))
      this.log(styles.muted(`   Task:        ${args.task.substring(0, 60)}${args.task.length > 60 ? '...' : ''}`))
      this.log(styles.muted(`   Directory:   ${workdir}`))
      this.log(styles.muted(`   Environment: ${environment}`))
      this.log(styles.muted(`   Permissions: ${permissionMode === 'safe' ? '🔒 safe' : '⚠️  danger'}`))
      this.log(styles.muted(`   Mode:        ${flags.detached ? '📦 detached' : '🖥️  foreground'}`))
      this.log('')
    }

    // Spawn the agent
    const spawnConfig: SpawnConfig = {
      task: args.task,
      workdir,
      runner: runner!.name,
      background: flags.detached,
    }

    try {
      const session = await runner!.spawn(spawnConfig)

      // Track in global session store
      const store = new SessionStore()
      const record = store.create({
        agentName,
        runner: runner!.name,
        task: args.task,
        workdir,
        sessionName: session.sessionName,
        environment,
        permissionMode,
      })
      store.close()

      if (jsonMode) {
        outputSuccessAsJson({
          id: record.id,
          agentName,
          runner: runner!.name,
          sessionName: session.sessionName,
          task: args.task,
          workdir,
          environment,
          permissionMode,
          status: 'running',
        }, createMetadata('run', flags))
        return
      }

      this.log(styles.success(`✓ Agent spawned: ${agentName} (${record.id})`))
      this.log('')
      this.log(styles.muted('Commands:'))
      this.log(styles.muted(`  prlt ps                    List running agents`))
      this.log(styles.muted(`  prlt peek ${agentName}       View output`))
      this.log(styles.muted(`  prlt poke ${agentName} "msg"  Send message`))
      this.log(styles.muted(`  prlt stop ${agentName}       Stop agent`))
      this.log(styles.muted(`  prlt logs ${agentName}       View full logs`))
      this.log('')
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', `Failed to spawn agent: ${error instanceof Error ? error.message : error}`, createMetadata('run', flags))
        return
      }
      this.error(`Failed to spawn agent: ${error instanceof Error ? error.message : error}`)
    }
  }
}
