/**
 * orchestrate machine — Machine-level orchestrator.
 *
 * Starts a persistent orchestrator that reads machine.db and sees ALL sessions
 * across ALL repos. Not scoped to a single HQ workspace — this is the root-level
 * supervisor for the entire machine's agent fleet.
 *
 * The orchestrator itself is a persistent named agent stored in machine.db.
 *
 * Usage:
 *   prlt orchestrate machine
 *   prlt orchestrate machine --prompt "restart any died agents, then assess"
 *   prlt orchestrate machine --name supervisor --prompt "manage all repos"
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { PromptCommand } from '../../lib/prompt-command.js'
import { styles } from '../../lib/styles.js'
import { MachineDB } from '../../lib/machine-db.js'
import { SessionStore } from '../../lib/session-store.js'
import { readMachineState, buildMachineOrchestratorPrompt } from '../../lib/machine-orchestrator.js'
import {
  ExecutionContext,
  ExecutionEnvironment,
  ExecutorType,
  DisplayMode,
  SessionManager,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution } from '../../lib/execution/runners.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

const MACHINE_ORCHESTRATOR_AGENT = 'machine-orchestrator'

export default class OrchestrateMachine extends PromptCommand {
  static description = 'Start the machine-level orchestrator — root supervisor for all agents across all repos'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --prompt "restart died agents, then assess all repos"',
    '<%= config.bin %> <%= command.id %> --name supervisor',
    '<%= config.bin %> <%= command.id %> --background',
  ]

  static flags = {
    prompt: Flags.string({
      char: 'p',
      description: 'Initial instructions for the orchestrator',
    }),
    name: Flags.string({
      char: 'n',
      description: 'Orchestrator name (default: machine-orchestrator)',
    }),
    background: Flags.boolean({
      char: 'b',
      description: 'Start detached (reattach later with prlt session attach)',
      default: false,
      exclusive: ['foreground'],
    }),
    foreground: Flags.boolean({
      char: 'f',
      description: 'Attach to the session in the current terminal (blocking)',
      default: false,
      exclusive: ['background'],
    }),
    executor: Flags.string({
      char: 'e',
      description: 'AI executor to use',
      options: ['claude-code', 'codex'],
      default: 'claude-code',
    }),
    json: Flags.boolean({
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
    machine: Flags.boolean({
      char: 'm',
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(OrchestrateMachine)
    const jsonMode = shouldOutputJson(flags)
    const agentName = flags.name || MACHINE_ORCHESTRATOR_AGENT
    const executor = (flags.executor || 'claude-code') as ExecutorType
    const displayMode: DisplayMode = flags.foreground ? 'foreground' : flags.background ? 'background' : 'foreground'

    const machineDb = new MachineDB()
    try {
      // =====================================================================
      // Check for already-running machine orchestrator
      // =====================================================================
      const existing = machineDb.getPersistentAgent(agentName)
      if (existing && (existing.status === 'running' || existing.status === 'starting')) {
        if (jsonMode) {
          this.log(JSON.stringify({
            success: true,
            executionId: existing.id,
            agentName,
            sessionId: existing.sessionId,
            alreadyRunning: true,
          }))
        } else {
          this.log('')
          this.log(styles.success(`Machine orchestrator "${agentName}" is already running (${existing.id})`))
          if (existing.sessionId) {
            this.log(styles.muted(`Attach: prlt session attach ${existing.sessionId}`))
            this.log(styles.muted(`Poke:   prlt session poke ${existing.sessionId} "your instructions"`))
          }
          this.log('')
        }
        return
      }

      if (existing && !jsonMode) {
        this.log(styles.muted(`Restarting machine orchestrator "${agentName}" (previous: ${existing.id}, status: ${existing.status})`))
      }

      // =====================================================================
      // Read machine state and build prompt
      // =====================================================================
      const state = readMachineState(machineDb)
      const orchestratorPrompt = buildMachineOrchestratorPrompt(state, flags.prompt)

      // Work directory: use home dir (orchestrator doesn't modify code)
      const workDir = os.homedir()

      if (!jsonMode) {
        this.log('')
        this.log(styles.header('Machine Orchestrator'))
        this.log(styles.muted(`Name: ${agentName}`))
        this.log(styles.muted(`Active agents: ${state.activeExecutions.length}`))
        this.log(styles.muted(`Active repos: ${state.activeRepos.length}`))
        this.log(styles.muted(`Persistent agents: ${state.persistentAgents.length}`))
        if (state.diedPersistentAgents.length > 0) {
          this.log(styles.warning(`Died agents needing restart: ${state.diedPersistentAgents.length}`))
        }
        this.log('')
      }

      // =====================================================================
      // Create execution record in machine DB (persistent)
      // =====================================================================
      const execution = machineDb.createExecution({
        prompt: flags.prompt || 'Machine-level orchestrator — supervise all agents across all repos',
        repoPath: workDir,
        agentName,
        executor,
        environment: 'host',
        persistent: true,
        cleanupPolicy: 'persistent',
      })

      if (!jsonMode) {
        this.log(styles.muted(`Execution: ${execution.id}`))
      }

      // =====================================================================
      // Build execution context
      // =====================================================================
      const context: ExecutionContext = {
        ticketId: execution.id,
        ticketTitle: 'Machine Orchestrator',
        ticketDescription: orchestratorPrompt,
        agentName,
        agentDir: workDir,
        worktreePath: workDir,
        branch: 'main',
        actionId: 'orchestrate',
        actionName: 'Orchestrate',
        actionPrompt: orchestratorPrompt,
        modifiesCode: false,
        executionEnvironment: 'host',
        isEphemeral: false,
        isOrchestrator: true,
      }

      // =====================================================================
      // Launch
      // =====================================================================
      if (!jsonMode) {
        this.log(styles.muted('Starting machine orchestrator...'))
      }

      const result = await runExecution('host', context, executor, DEFAULT_EXECUTION_CONFIG, {
        displayMode,
      })

      if (result.success) {
        machineDb.updateStatus(execution.id, 'running')
        machineDb.updateProcessInfo(execution.id, {
          containerId: result.containerId,
          sessionId: result.sessionId,
        })

        // Track in global session store
        try {
          const sessionStore = new SessionStore()
          sessionStore.create({
            agentName,
            runner: executor,
            task: 'Machine orchestrator — root supervisor',
            workdir: workDir,
            sessionName: result.sessionId || `${execution.id}-${agentName}`,
            environment: 'host',
            permissionMode: 'danger',
          })
          sessionStore.close()
        } catch {
          // Non-fatal
        }

        if (jsonMode) {
          this.log(JSON.stringify({
            success: true,
            executionId: execution.id,
            agentName,
            sessionId: result.sessionId,
            persistent: true,
            activeAgents: state.activeExecutions.length,
            activeRepos: state.activeRepos.length,
          }))
        } else {
          this.log('')
          this.log(styles.success(`Machine orchestrator "${agentName}" started (${execution.id})`))
          this.log(styles.muted('Mode: persistent (root supervisor, survives restarts)'))
          if (result.sessionId) {
            this.log(styles.muted(`Session: ${result.sessionId}`))
            this.log(styles.muted(`Attach:  prlt session attach ${result.sessionId}`))
            this.log(styles.muted(`Poke:    prlt session poke ${result.sessionId} "instructions"`))
          }
          this.log('')
        }
      } else {
        machineDb.updateStatus(execution.id, 'failed', undefined, result.error)

        if (jsonMode) {
          this.log(JSON.stringify({ success: false, executionId: execution.id, error: result.error }))
        } else {
          this.log(styles.error(`Failed to start machine orchestrator: ${result.error}`))
        }
      }
    } finally {
      machineDb.close()
    }
  }
}
