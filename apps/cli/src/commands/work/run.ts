/**
 * work run — Ticketless work mode.
 *
 * Spawns an agent without a ticket or HQ workspace.
 * Any directory, any repo, just a prompt.
 *
 * Two modes:
 *   Ephemeral (default): spawn, work, exit — like `docker run`
 *   Persistent (--keep-alive): long-lived named agent that accumulates
 *     context and responds to session pokes — like `docker run --name`
 *     with a restart policy. Survives terminal/HQ restarts.
 *
 * Usage:
 *   prlt work run --prompt "refactor auth module"
 *   prlt work run --dir ~/Projects/other-repo --prompt "fix the auth bug"
 *   prlt work run --repo https://github.com/org/repo --prompt "add tests"
 *   prlt work run --name reviewer --keep-alive --prompt "you are the backend reviewer"
 */

import { Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { PromptCommand } from '../../lib/prompt-command.js'
import { styles } from '../../lib/styles.js'
import { generateAgentName } from '../../lib/agent-naming.js'
import { MachineDB } from '../../lib/machine-db.js'
import { SessionStore } from '../../lib/session-store.js'
import {
  ExecutionContext,
  ExecutionEnvironment,
  ExecutorType,
  DisplayMode,
  SessionManager,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution } from '../../lib/execution/runners.js'
import { shouldOutputJson, outputErrorAsJson, createMetadata, outputExecutionResultAsJson } from '../../lib/prompt-json.js'

export default class WorkRun extends PromptCommand {
  static description = 'Run an agent without a ticket — ticketless work mode'

  static examples = [
    '<%= config.bin %> <%= command.id %> --prompt "refactor auth module"',
    '<%= config.bin %> <%= command.id %> --dir ~/Projects/other-repo --prompt "fix the auth bug"',
    '<%= config.bin %> <%= command.id %> --repo https://github.com/org/repo --prompt "add tests"',
    '<%= config.bin %> <%= command.id %> --prompt "add unit tests" --create-pr',
    '<%= config.bin %> <%= command.id %> --prompt "fix flaky test" --environment host',
    '<%= config.bin %> <%= command.id %> --name reviewer --keep-alive --prompt "you are the backend reviewer"',
    '<%= config.bin %> <%= command.id %> --name ci-watcher --keep-alive --prompt "monitor CI failures and fix them"',
  ]

  static flags = {
    prompt: Flags.string({
      char: 'p',
      description: 'Work prompt — what the agent should do',
      required: true,
    }),
    dir: Flags.string({
      char: 'd',
      description: 'Working directory (defaults to cwd)',
    }),
    repo: Flags.string({
      char: 'r',
      description: 'Git repo URL to clone and work in',
    }),
    'create-pr': Flags.boolean({
      description: 'Create a PR when work is ready (no ticket linking)',
      default: false,
    }),
    'keep-alive': Flags.boolean({
      char: 'k',
      description: 'Persistent agent — survives restarts, accumulates context, responds to pokes',
      default: false,
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Execution environment',
      options: ['host', 'sandbox', 'docker', 'devcontainer'],
      default: 'host',
    }),
    executor: Flags.string({
      description: 'AI executor to use',
      options: ['claude-code', 'codex'],
      default: 'claude-code',
    }),
    mode: Flags.string({
      description: 'Display mode for agent output',
      options: ['terminal', 'background', 'foreground'],
    }),
    name: Flags.string({
      description: 'Agent name (required for --keep-alive, auto-generated otherwise)',
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
    const { flags } = await this.parse(WorkRun)
    const jsonMode = shouldOutputJson(flags)
    const keepAlive = flags['keep-alive']

    // =========================================================================
    // Validate persistent agent flags
    // =========================================================================
    if (keepAlive && !flags.name) {
      const msg = '--keep-alive requires --name (persistent agents need a stable identity)'
      if (jsonMode) {
        outputErrorAsJson('INVALID_FLAGS', msg, createMetadata('work run', flags))
        return
      }
      this.error(msg)
    }

    // =========================================================================
    // Resolve working directory
    // =========================================================================
    let workDir: string

    if (flags.dir && flags.repo) {
      const msg = 'Cannot specify both --dir and --repo'
      if (jsonMode) {
        outputErrorAsJson('INVALID_FLAGS', msg, createMetadata('work run', flags))
        return
      }
      this.error(msg)
    }

    if (flags.repo) {
      workDir = this.cloneRepo(flags.repo)
    } else if (flags.dir) {
      workDir = path.resolve(flags.dir)
      if (!fs.existsSync(workDir)) {
        const msg = `Directory does not exist: ${workDir}`
        if (jsonMode) {
          outputErrorAsJson('DIR_NOT_FOUND', msg, createMetadata('work run', flags))
          return
        }
        this.error(msg)
      }
    } else {
      workDir = process.cwd()
    }

    // =========================================================================
    // Resolve agent name and display mode
    // =========================================================================
    const agentName = flags.name || generateAgentName()
    const environment = flags.environment as ExecutionEnvironment
    const executor = flags.executor as ExecutorType
    // Persistent agents default to background mode (long-lived, reattach later)
    const displayMode = (flags.mode || (keepAlive ? 'background' : 'foreground')) as DisplayMode

    const machineDb = new MachineDB()
    try {
      // =====================================================================
      // Check for existing persistent agent (restart/reattach)
      // =====================================================================
      if (keepAlive) {
        const existing = machineDb.getPersistentAgent(agentName)
        if (existing && (existing.status === 'running' || existing.status === 'starting')) {
          // Agent is already running — tell user to attach
          if (jsonMode) {
            this.log(JSON.stringify({
              success: true,
              executionId: existing.id,
              agentName,
              sessionId: existing.sessionId,
              containerId: existing.containerId,
              repoPath: existing.repoPath,
              persistent: true,
              alreadyRunning: true,
            }))
          } else {
            this.log('')
            this.log(styles.success(`Persistent agent "${agentName}" is already running (${existing.id})`))
            if (existing.sessionId) {
              this.log(styles.muted(`Attach: prlt session attach ${existing.sessionId}`))
              this.log(styles.muted(`Poke:   prlt session poke ${existing.sessionId} "your message"`))
            }
            this.log('')
          }
          return
        }

        // Existing persistent agent is stopped/failed — restart it
        if (existing && !jsonMode) {
          this.log(styles.muted(`Restarting persistent agent "${agentName}" (previous: ${existing.id}, status: ${existing.status})`))
        }
      }

      if (!jsonMode) {
        this.log('')
        this.log(styles.header(keepAlive ? 'Persistent Agent' : 'Ticketless Work'))
        this.log(styles.muted(`Agent: ${agentName}${keepAlive ? ' (persistent)' : ''}`))
        this.log(styles.muted(`Directory: ${workDir}`))
        this.log(styles.muted(`Prompt: ${flags.prompt.substring(0, 80)}${flags.prompt.length > 80 ? '...' : ''}`))
        this.log('')
      }

      // =====================================================================
      // Create execution record in machine DB
      // =====================================================================
      const execution = machineDb.createExecution({
        prompt: flags.prompt,
        repoPath: workDir,
        agentName,
        executor,
        environment,
        createPr: flags['create-pr'],
        persistent: keepAlive,
        cleanupPolicy: keepAlive ? 'persistent' : 'on-exit',
      })

      if (!jsonMode) {
        this.log(styles.muted(`Execution: ${execution.id}`))
      }

      // =====================================================================
      // Build execution context (no ticket, just prompt)
      // =====================================================================
      const context: ExecutionContext = {
        ticketId: execution.id,
        ticketTitle: flags.prompt.substring(0, 60),
        ticketDescription: flags.prompt,
        agentName,
        agentDir: workDir,
        worktreePath: workDir,
        branch: this.getCurrentBranch(workDir) || 'main',
        createPR: flags['create-pr'],
        actionId: 'run',
        actionName: 'Run',
        actionPrompt: flags.prompt,
        modifiesCode: !keepAlive, // Persistent agents may just be watchers/reviewers
        executionEnvironment: environment,
        isEphemeral: !keepAlive,
      }

      // =====================================================================
      // Launch execution
      // =====================================================================
      if (!jsonMode) {
        this.log(styles.muted('Starting agent...'))
      }

      const result = await runExecution(environment, context, executor, DEFAULT_EXECUTION_CONFIG, {
        displayMode,
        sessionManager: environment === 'devcontainer' ? 'tmux' as SessionManager : undefined,
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
            task: flags.prompt.substring(0, 200),
            workdir: workDir,
            sessionName: result.sessionId || `${execution.id}-${agentName}`,
            environment: environment === 'docker' || environment === 'devcontainer' ? 'docker' : 'host',
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
            containerId: result.containerId,
            repoPath: workDir,
            prompt: flags.prompt,
            persistent: keepAlive,
          }))
        } else {
          this.log('')
          this.log(styles.success(`Agent ${agentName} started (${execution.id})`))
          if (keepAlive) {
            this.log(styles.muted('Mode: persistent (survives restarts, reattach anytime)'))
          }
          if (result.sessionId) {
            this.log(styles.muted(`Session: ${result.sessionId}`))
            this.log(styles.muted(`Attach:  prlt session attach ${result.sessionId}`))
            if (keepAlive) {
              this.log(styles.muted(`Poke:    prlt session poke ${result.sessionId} "your message"`))
            }
          }
          this.log('')
        }
      } else {
        machineDb.updateStatus(execution.id, 'failed', undefined, result.error)

        if (jsonMode) {
          this.log(JSON.stringify({
            success: false,
            executionId: execution.id,
            error: result.error,
          }))
        } else {
          this.log(styles.error(`Failed to start agent: ${result.error}`))
        }
      }
    } finally {
      machineDb.close()
    }
  }

  /**
   * Clone a git repo into a temp directory and return the path.
   */
  private cloneRepo(repoUrl: string): string {
    // Extract repo name from URL for directory naming
    const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo'
    const tmpDir = path.join(process.env.TMPDIR || '/tmp', `prlt-run-${repoName}-${Date.now()}`)

    try {
      this.log(styles.muted(`Cloning ${repoUrl}...`))
      execSync(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
      return tmpDir
    } catch (error) {
      throw new Error(`Failed to clone repository: ${repoUrl}\n${(error as Error).message}`)
    }
  }

  /**
   * Get the current git branch for a directory, or null if not a git repo.
   */
  private getCurrentBranch(dir: string): string | null {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      return null
    }
  }
}
