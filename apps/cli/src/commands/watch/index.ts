/**
 * prlt watch — Minimal poller that watches GitHub/Linear/agents and pokes an orchestrator.
 *
 * Polls external systems on an interval, diffs state, and sends a summary
 * of changes to the target orchestrator agent via `prlt session poke`.
 *
 * The orchestrator (LLM agent) reads the poke and decides what to do —
 * merge, rebase, spawn, ignore, ask human. This command does NO decision-making.
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
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
import { SimplePoller } from '../../lib/orchestrate/simple-poller.js'

export default class Watch extends PromptCommand {
  static description = 'Poll GitHub/Linear/agents and poke an orchestrator with changes'

  static examples = [
    '<%= config.bin %> watch --target orchestrator',
    '<%= config.bin %> watch --target orchestrator --poll-interval 30',
    '<%= config.bin %> watch --target my-orchestrator --verbose',
    '<%= config.bin %> watch --target orchestrator --once',
  ]

  static flags = {
    ...machineOutputFlags,
    target: Flags.string({
      description: 'Orchestrator agent/session name to poke with changes',
      required: true,
      char: 't',
    }),
    'poll-interval': Flags.integer({
      description: 'Poll interval in seconds',
      default: 60,
    }),
    verbose: Flags.boolean({
      description: 'Show detailed output including poll results',
      char: 'v',
      default: false,
    }),
    'run-mode': Flags.string({
      description: 'Run mode (once=single poll cycle, continuous=keep watching)',
      options: ['once', 'continuous'],
      default: 'continuous',
    }),
    once: Flags.boolean({
      description: '[deprecated: use --run-mode once] Run a single poll cycle and exit',
      default: false,
      hidden: true,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Watch)

    // === Deprecated flag resolution (backward compat) ===
    if (flags.once && flags['run-mode'] === 'continuous') flags['run-mode'] = 'once'
    if (flags['run-mode'] === 'once') flags.once = true

    const jsonMode = shouldOutputJson(flags)
    const verbose = flags.verbose

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('watch', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)

    try {
      const poller = new SimplePoller({
        db,
        log: (msg) => { if (verbose) this.log(styles.muted(msg)) },
        cwd: workspaceInfo.path,
      })

      // One-shot mode
      if (flags.once) {
        // Run two polls: first to capture baseline, second to detect changes
        // In one-shot mode, we just report current state
        await poller.poll() // baseline
        const result = await poller.poll()

        if (jsonMode) {
          outputSuccessAsJson(
            { mode: 'once', changes: result.changes, message: result.message },
            createMetadata('watch', flags),
          )
          return
        }

        if (result.message) {
          this.log(result.message)
        } else {
          this.log(styles.muted('No changes detected.'))
        }
        return
      }

      // Daemon mode
      if (!jsonMode) {
        this.log('')
        this.log(styles.title('Watch daemon started'))
        this.log(styles.muted(`  Target: ${flags.target}`))
        this.log(styles.muted(`  Poll interval: ${flags['poll-interval']}s`))
        this.log(styles.muted('  Press Ctrl+C to stop'))
        this.log('')
      }

      // Initial baseline poll (captures current state without poking)
      this.log(styles.muted('  Capturing baseline state...'))
      await poller.poll()
      this.log(styles.muted('  Baseline captured. Watching for changes...'))
      this.log('')

      if (jsonMode) {
        outputSuccessAsJson(
          { status: 'running', mode: 'daemon', target: flags.target, pollInterval: flags['poll-interval'] },
          createMetadata('watch', flags),
        )
      }

      // Poll loop
      const pollTimer = setInterval(async () => {
        try {
          if (verbose) this.log(styles.muted(`[watch] Polling at ${new Date().toISOString()}...`))

          const result = await poller.poll()

          if (result.message) {
            if (verbose) {
              this.log('')
              this.log(styles.info('Changes detected:'))
              this.log(result.message)
              this.log('')
            }

            // Poke the orchestrator
            this.pokeTarget(flags.target, result.message, verbose)
          } else if (verbose) {
            this.log(styles.muted('[watch] No changes.'))
          }
        } catch (err) {
          this.log(styles.error(`[watch] Poll error: ${err instanceof Error ? err.message : String(err)}`))
        }
      }, flags['poll-interval'] * 1000)

      // Keep alive
      const keepAlive = setInterval(() => {}, 60_000)

      // Graceful shutdown
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          clearInterval(pollTimer)
          clearInterval(keepAlive)
          this.log(styles.muted('\n  Watch daemon stopped'))
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
   * Poke the target orchestrator agent with a message.
   * Uses `prlt session poke` to send the message to the agent's tmux session.
   */
  private pokeTarget(target: string, message: string, verbose: boolean): void {
    try {
      // Use prlt session poke to send the message
      // Pass message via stdin to handle multi-line safely
      execSync(`prlt session poke ${target} -`, {
        input: message,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })

      if (verbose) {
        this.log(styles.success(`  Poked ${target} with ${message.split('\n').length} lines`))
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this.log(styles.error(`[watch] Failed to poke ${target}: ${errMsg}`))
    }
  }
}
