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
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
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
  loadHooksYaml,
  loadWorkflowYaml,
  syncHooksFromYaml,
  applyPreset,
  PRESET_NAMES,
} from '../../lib/orchestrate/index.js'
import type { PresetName, OrchestrateActionResult } from '../../lib/orchestrate/index.js'
import { initHookManager } from '../../lib/work-lifecycle/hooks/index.js'
import { initWorkLifecycleAdapter } from '../../lib/work-lifecycle/adapter.js'
import { SessionStore } from '../../lib/session-store.js'
import { RECONCILER_SESSION_NAME } from '../reconcile/index.js'
export default class Orchestrate extends PMOCommand {
  static description = 'Start the autonomous pipeline daemon with event-driven hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --preset supervised',
    '<%= config.bin %> <%= command.id %> --load-yaml',
    '<%= config.bin %> <%= command.id %> --poll-interval 300',
    '<%= config.bin %> <%= command.id %> --once on_ci_green --pr 123',
  ]

  static flags = {
    ...pmoBaseFlags,
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

  async execute(): Promise<void> {
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

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new SqliteDatabase(dbPath)
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
            } catch { /* ignore */ }
          }
          if (workflowYaml.branches?.strategy) {
            try {
              db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('workflow.branches.strategy', ?)").run(workflowYaml.branches.strategy)
            } catch { /* ignore */ }
          }
          if (workflowYaml.review?.auto_merge_on_green !== undefined) {
            try {
              db.prepare("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('workflow.review.auto_merge_on_green', ?)").run(String(workflowYaml.review.auto_merge_on_green))
            } catch { /* ignore */ }
          }
        }
      }

      // Apply preset if specified
      if (parsedFlags.preset) {
        const count = applyPreset(db, parsedFlags.preset as PresetName)
        this.log(styles.muted(`  Applied preset "${parsedFlags.preset}" (${count} hooks)`))
      }

      // Create the orchestrate engine
      const engine = new OrchestrateEngine({
        db,
        log: (msg) => {
          if (verbose || jsonMode) {
            this.log(msg)
          }
        },
        onNotify: (hookName, event, action, result) => {
          this.log(`${styles.info('[notify]')} ${hookName}: ${event} → ${action} (${result.success ? 'ok' : 'failed'})`)
        },
      })

      // Initialize work-lifecycle systems
      initWorkLifecycleAdapter()
      initHookManager(db)

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

      // Daemon mode: start the engine and run until stopped
      engine.start()

      // Auto-spawn reconciler daemon if not already running
      const reconcilerSpawned = this.ensureReconcilerDaemon(verbose)

      if (jsonMode) {
        outputSuccessAsJson(
          { status: 'running', mode: 'daemon', reconciler: reconcilerSpawned },
          createMetadata('orchestrate', flags),
        )
      } else {
        this.log('')
        this.log(styles.title('Orchestrate daemon started'))
        this.log(styles.muted('  Listening for events on the EventBus'))
        this.log(styles.muted('  Press Ctrl+C to stop'))

        // Show configured hooks summary
        try {
          const hookCount = (db.prepare('SELECT COUNT(*) as count FROM pmo_work_hooks WHERE enabled = 1').get() as { count: number })?.count ?? 0
          this.log(styles.muted(`  ${hookCount} active hooks`))
        } catch { /* ignore */ }

        if (reconcilerSpawned) {
          this.log(styles.muted('  Reconciler daemon: running'))
        }

        if (parsedFlags['poll-interval'] && (parsedFlags['poll-interval'] as number) > 0) {
          this.log(styles.muted(`  Polling every ${parsedFlags['poll-interval']}s for external events`))
        }
        this.log('')
      }

      // Set up polling if configured
      const pollInterval = parsedFlags['poll-interval'] as number
      let pollTimer: ReturnType<typeof setInterval> | null = null

      if (pollInterval > 0) {
        pollTimer = setInterval(() => {
          void this.pollExternalEvents(engine, db, verbose)
        }, pollInterval * 1000)
      }

      // Set up reconciler health supervision (check every 60s)
      const reconcilerHealthTimer = setInterval(() => {
        this.superviseReconcilerDaemon(verbose)
      }, 60_000)

      // Keep the process alive until signal
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          engine.stop()
          if (pollTimer) clearInterval(pollTimer)
          clearInterval(reconcilerHealthTimer)
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
   * Ensure the reconciler daemon is running. Spawns it if not.
   * Returns true if reconciler is running (either already was or just spawned).
   */
  private ensureReconcilerDaemon(verbose: boolean): boolean {
    const store = new SessionStore()
    try {
      const existing = store.getRunningDaemon('reconciler')
      if (existing && store.isTmuxSessionAlive(existing.sessionName)) {
        if (verbose) {
          this.log(styles.muted('[orchestrate] Reconciler daemon already running'))
        }
        return true
      }

      // Mark stale record as done
      if (existing) {
        store.updateStatus(existing.id, 'done')
      }

      return this.spawnReconcilerDaemon(store, verbose)
    } finally {
      store.close()
    }
  }

  /**
   * Spawn the reconciler daemon as a tmux session.
   */
  private spawnReconcilerDaemon(store: SessionStore, verbose: boolean): boolean {
    let prltPath: string
    try {
      prltPath = execSync('which prlt', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    } catch {
      prltPath = 'prlt'
    }

    try {
      execSync(
        `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" "${prltPath} reconcile --watch --foreground --interval 30"`,
        { stdio: 'pipe' },
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.log(styles.warning(`[orchestrate] Failed to spawn reconciler daemon: ${msg}`))
      return false
    }

    store.create({
      agentName: 'reconciler',
      runner: 'daemon',
      task: 'session-reconciliation',
      workdir: process.cwd(),
      sessionName: RECONCILER_SESSION_NAME,
      environment: 'host',
      permissionMode: 'safe',
      role: 'daemon',
      daemonType: 'reconciler',
    })

    if (verbose) {
      this.log(styles.success('[orchestrate] Reconciler daemon spawned'))
    }
    return true
  }

  /**
   * Check if reconciler daemon is still alive. Restart if dead.
   * Called periodically by the orchestrator's health supervision timer.
   */
  private superviseReconcilerDaemon(verbose: boolean): void {
    const store = new SessionStore()
    try {
      const existing = store.getRunningDaemon('reconciler')

      if (!existing) {
        // No record at all — spawn fresh
        if (verbose) {
          this.log(styles.warning('[orchestrate] Reconciler daemon not found, spawning...'))
        }
        this.spawnReconcilerDaemon(store, verbose)
        return
      }

      if (store.isTmuxSessionAlive(existing.sessionName)) {
        // Still alive, nothing to do
        return
      }

      // Dead — mark as done and restart
      store.updateStatus(existing.id, 'done')
      this.log(styles.warning('[orchestrate] Reconciler daemon died, restarting...'))
      this.spawnReconcilerDaemon(store, verbose)
    } finally {
      store.close()
    }
  }

  /**
   * Poll external event sources for new events.
   * Currently a stub — real implementations would check Linear, GitHub, etc.
   */
  private async pollExternalEvents(
    engine: OrchestrateEngine,
    db: SqliteDatabase,
    verbose: boolean,
  ): Promise<void> {
    if (verbose) {
      this.log(styles.muted('[orchestrate] Polling external event sources...'))
    }

    // Check for tickets in "Ready" status → fire on_ticket_ready
    try {
      const readyTickets = db.prepare(`
        SELECT t.id, t.title, ws.category
        FROM pmo_tickets t
        JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
        WHERE ws.category = 'todo'
          AND t.assignee IS NULL
          AND t.id NOT IN (
            SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
          )
        LIMIT 5
      `).all() as Array<{ id: string; title: string }>

      for (const ticket of readyTickets) {
        await engine.fireEvent('on_ticket_ready', {
          event: 'on_ticket_ready',
          ticket: ticket.id,
        })
      }
    } catch {
      // Polling errors are non-fatal
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
