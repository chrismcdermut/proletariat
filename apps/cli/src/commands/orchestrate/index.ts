/**
 * prlt orchestrate — Autonomous pipeline daemon with event-driven hooks.
 *
 * Starts the orchestrate engine which:
 * 1. Loads hook configuration from DB (synced from YAML/presets/CLI)
 * 2. Subscribes to EventBus events for internal triggers
 * 3. Optionally polls external sources (Linear, GitHub) for events
 * 4. Executes matching hooks with mode-aware behavior (auto/confirm/notify/off)
 *
 * External events can also be fired via `prlt hook fire <event>`.
 */

import { Flags } from '@oclif/core'
import * as readline from 'node:readline'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  OrchestrateEngine,
  OrchestratePoller,
  loadHooksYaml,
  loadWorkflowYaml,
  syncHooksFromYaml,
  applyPreset,
  PRESET_NAMES,
  createLlmDecisionHandler,
} from '../../lib/orchestrate/index.js'
import type { PresetName, OrchestrateActionResult } from '../../lib/orchestrate/index.js'
import { initWorkLifecycleAdapter } from '../../lib/work-lifecycle/adapter.js'
import {
  ensureDaemonRunning,
  isDaemonAlive,
  reconcilerDaemonSpec,
} from '../../lib/session/daemon-manager.js'

export default class Orchestrate extends PromptCommand {
  static description = 'Start the autonomous pipeline daemon with event-driven hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --preset supervised',
    '<%= config.bin %> <%= command.id %> --load-yaml',
    '<%= config.bin %> <%= command.id %> --poll-interval 300',
    '<%= config.bin %> <%= command.id %> --once on_ci_green --pr 123',
  ]

  static flags = {
    ...machineOutputFlags,
    preset: Flags.string({
      description: 'Apply a preset before starting (aggressive, conservative, supervised)',
      options: PRESET_NAMES,
    }),
    'load-yaml': Flags.boolean({
      description: 'Load hooks from .proletariat/hooks.yml before starting',
      default: false,
    }),
    'poll-interval': Flags.integer({
      description: 'Poll interval in seconds for external event sources (0 to disable)',
      default: 0,
    }),
    once: Flags.string({
      description: 'Fire a single event and exit (useful for CI/GitHub Actions)',
    }),
    ticket: Flags.string({
      description: 'Ticket ID (for --once)',
      char: 't',
    }),
    pr: Flags.integer({
      description: 'PR number (for --once)',
    }),
    branch: Flags.string({
      description: 'Branch name (for --once)',
    }),
    agent: Flags.string({
      description: 'Agent name (for --once)',
    }),
    verbose: Flags.boolean({
      description: 'Show detailed output',
      char: 'v',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Orchestrate)
    const jsonMode = shouldOutputJson(flags)
    const parsedFlags = flags as Record<string, unknown>

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('orchestrate', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)
    const verbose = parsedFlags.verbose as boolean

    try {
      // Load YAML config if requested
      if (parsedFlags['load-yaml']) {
        const hooksYaml = loadHooksYaml(workspaceInfo.path)
        if (hooksYaml) {
          const count = syncHooksFromYaml(db, hooksYaml)
          this.log(styles.muted(`  Loaded ${count} hooks from hooks.yml`))
        } else {
          this.log(styles.muted('  No .proletariat/hooks.yml found'))
        }

        const workflowYaml = loadWorkflowYaml(workspaceInfo.path)
        if (workflowYaml) {
          this.log(styles.muted('  Loaded workflow.yml'))
          // Store workflow config in settings for later use
          if (workflowYaml.branches?.target) {
            try {
              db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('workflow.branches.target', ?)").run(workflowYaml.branches.target)
            } catch { /* workspace_settings table may not exist yet — non-fatal, orchestration works without it */ }
          }
          if (workflowYaml.branches?.strategy) {
            try {
              db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('workflow.branches.strategy', ?)").run(workflowYaml.branches.strategy)
            } catch { /* workspace_settings table may not exist yet — non-fatal, orchestration works without it */ }
          }
          if (workflowYaml.review?.auto_merge_on_green !== undefined) {
            try {
              db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('workflow.review.auto_merge_on_green', ?)").run(String(workflowYaml.review.auto_merge_on_green))
            } catch { /* workspace_settings table may not exist yet — non-fatal, orchestration works without it */ }
          }
        }
      }

      // Apply preset if specified
      if (parsedFlags.preset) {
        const count = applyPreset(db, parsedFlags.preset as PresetName)
        this.log(styles.muted(`  Applied preset "${parsedFlags.preset}" (${count} hooks)`))
      }

      // Readline interface for interactive confirmations in daemon mode
      let rl: readline.Interface | null = null

      // Create the LLM decision handler for tier-2 hooks.
      // This is the bridge between the deterministic daemon (tier 1) and human (tier 3).
      const logFn = (msg: string) => {
        if (verbose || jsonMode) {
          this.log(msg)
        }
      }
      const llmDecisionHandler = createLlmDecisionHandler({ log: logFn })

      // Create the orchestrate engine
      const engine = new OrchestrateEngine({
        db,
        log: logFn,
        onLlmDecision: llmDecisionHandler,
        onConfirm: async (hookName, event, action) => {
          // In JSON mode, output as JSON and auto-deny (external system should handle).
          // Use console.log instead of outputSuccessAsJson to avoid ExitError killing the daemon.
          if (jsonMode) {
            console.log(JSON.stringify({
              type: 'success',
              prompt: null,
              success: true,
              result: { type: 'confirmation_required', hookName, event, action },
              metadata: createMetadata('orchestrate', flags),
            }, null, 2))
            return false
          }

          // Interactive confirmation via readline
          return new Promise<boolean>((resolve) => {
            this.log('')
            this.log(`${styles.warning('[confirm]')} Hook "${hookName}" wants to run:`)
            this.log(`  Event: ${styles.emphasis(event)}`)
            this.log(`  Action: ${styles.code(action)}`)

            if (!rl) {
              rl = readline.createInterface({ input: process.stdin, output: process.stdout })
            }

            rl.question(`  Approve? (yes/no): `, (answer) => {
              const approved = answer.trim().toLowerCase().startsWith('y')
              if (approved) {
                this.log(styles.success('  Approved'))
              } else {
                this.log(styles.muted('  Denied'))
              }
              resolve(approved)
            })
          })
        },
        onNotify: (hookName, event, action, result) => {
          this.log(`${styles.info('[notify]')} ${hookName}: ${event} → ${action} (${result.success ? 'ok' : 'failed'})`)
        },
      })

      // Initialize work-lifecycle adapter (event hub for provider state changes).
      // NOTE: Do NOT call initHookManager() here — the OrchestrateEngine already
      // handles hook execution with mode-aware behavior (auto/confirm/notify/off).
      // Adding HookManager would cause double-execution: the engine respects modes
      // while HookManager executes ALL enabled hooks unconditionally, bypassing
      // safety gates like confirm mode. See PRLT-1218.
      initWorkLifecycleAdapter()

      // One-shot mode: fire a single event and exit
      if (parsedFlags.once) {
        const eventName = parsedFlags.once as string
        const results = await engine.fireEvent(eventName, {
          event: eventName,
          ticket: parsedFlags.ticket as string | undefined,
          pr: parsedFlags.pr as number | undefined,
          branch: parsedFlags.branch as string | undefined,
          agent: parsedFlags.agent as string | undefined,
        })

        if (jsonMode) {
          outputSuccessAsJson(
            { event: eventName, results, mode: 'once' },
            createMetadata('orchestrate', flags),
          )
          return
        }

        this.logResults(eventName, results)
        return
      }

      // PRLT-1287: Auto-spawn reconciler daemon on orchestrate startup
      const hqPath = workspaceInfo.path
      const reconcilerSpec = reconcilerDaemonSpec()
      const reconcilerSession = ensureDaemonRunning(hqPath, reconcilerSpec)
      if (reconcilerSession) {
        logFn(`[daemon] Reconciler daemon running (${reconcilerSession})`)
      } else {
        logFn('[daemon] Failed to spawn reconciler daemon — will retry on next health check')
      }

      // Daemon mode: start the engine and run until stopped
      engine.start()

      // Prevent oclif from killing the daemon — oclif's error handler calls
      // process.exit(0) after run() resolves, which terminates the daemon.
      // Override process.exit to ignore clean exits while the daemon is running.
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code?: number) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code as number)
      }) as never

      if (jsonMode) {
        // In daemon mode, output JSON status without throwing ExitError.
        // outputSuccessAsJson throws oclif ExitError which would kill the daemon loop.
        console.log(JSON.stringify({
          type: 'success',
          prompt: null,
          success: true,
          result: { status: 'running', mode: 'daemon' },
          metadata: createMetadata('orchestrate', flags),
        }, null, 2))
      } else {
        this.log('')
        this.log(styles.title('Orchestrate daemon started'))
        this.log(styles.muted('  Listening for events on the EventBus'))
        this.log(styles.muted('  Press Ctrl+C to stop'))

        // Show configured hooks summary
        try {
          const hookCount = (db.prepare('SELECT COUNT(*) as count FROM pmo_work_hooks WHERE enabled = 1').get() as { count: number })?.count ?? 0
          this.log(styles.muted(`  ${hookCount} active hooks`))
        } catch { /* hook count is cosmetic — db may not have pmo_work_hooks table yet */ }

        this.log(styles.muted('  LLM agent (tier 2) active — daemon decisions have a brain'))
        if (parsedFlags['poll-interval'] && (parsedFlags['poll-interval'] as number) > 0) {
          this.log(styles.muted(`  Polling every ${parsedFlags['poll-interval']}s for external events`))
        }
        this.log('')
      }

      // Set up polling if configured
      const pollInterval = parsedFlags['poll-interval'] as number
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let poller: OrchestratePoller | null = null

      if (pollInterval > 0) {
        try {
          poller = new OrchestratePoller({
            engine,
            db,
            log: (msg) => { if (verbose) this.log(styles.muted(msg)) },
            cwd: workspaceInfo.path,
          })
          pollTimer = setInterval(() => {
            void poller!.poll()
          }, pollInterval * 1000)
        } catch (err) {
          this.log(styles.error(`  Failed to start poller: ${err instanceof Error ? err.message : String(err)}`))
        }
      }

      // Keep Node.js event loop alive and periodically check for timed-out
      // LLM decisions. Even with onLlmDecision wired, this is a safety net:
      // if the callback throws or is slow, queued decisions can accumulate.
      // Every 60s, escalate any LLM decisions that exceeded their timeout.
      const keepAlive = setInterval(() => {
        const escalated = engine.escalateTimedOutLlmDecisions()
        if (escalated > 0) {
          logFn(`[daemon] Escalated ${escalated} timed-out LLM decision(s) to human tier`)
        }

        // PRLT-1287: Supervise reconciler daemon — restart if dead
        if (!isDaemonAlive(hqPath, 'reconciler')) {
          logFn('[daemon] Reconciler daemon died — restarting...')
          const restarted = ensureDaemonRunning(hqPath, reconcilerSpec)
          if (restarted) {
            logFn(`[daemon] Reconciler daemon restarted (${restarted})`)
          } else {
            logFn('[daemon] Failed to restart reconciler daemon')
          }
        }
      }, 60_000)

      // Keep the process alive until signal
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          engine.stop()
          if (pollTimer) clearInterval(pollTimer)
          if (rl) { rl.close(); rl = null }
          this.log(styles.muted('\n  Orchestrate daemon stopped'))
          resolve()
        }

        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    } finally {
      db.close()
    }
  }

  /**
   * Log the results of firing an event.
   */
  private logResults(event: string, results: OrchestrateActionResult[]): void {
    if (results.length === 0) {
      this.log(styles.info(`No hooks configured for event: ${event}`))
      return
    }

    this.log(styles.title(`Event: ${event}`))
    for (const result of results) {
      const status = result.skipped
        ? styles.muted('skipped')
        : result.awaitingConfirmation
          ? styles.warning('awaiting')
          : result.success
            ? styles.success('ok')
            : styles.error('failed')
      this.log(`  ${status} ${result.action} ${styles.muted(`${result.durationMs}ms`)}`)
      if (result.error) {
        this.log(`       ${styles.error(result.error)}`)
      }
    }
  }
}
