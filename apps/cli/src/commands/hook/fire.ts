/**
 * prlt hook fire <event> — Manually fire an orchestrate event.
 *
 * This is the bridge between external event sources (GitHub Actions, polling, etc.)
 * and the internal orchestrate engine. When an external system detects an event
 * (e.g., CI passes), it runs `prlt hook fire on_ci_green --pr 123` to trigger
 * the configured hooks.
 */

import { Args, Flags } from '@oclif/core'
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
  ORCHESTRATE_EVENTS,
} from '../../lib/orchestrate/index.js'
import type { OrchestrateEventContext } from '../../lib/orchestrate/index.js'

export default class HookFire extends PromptCommand {
  static description = 'Fire an orchestrate event to trigger configured hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %> on_ci_green --pr 123',
    '<%= config.bin %> <%= command.id %> on_pr_merged --ticket TKT-100 --pr 456',
    '<%= config.bin %> <%= command.id %> on_ticket_ready --ticket TKT-200',
    '<%= config.bin %> <%= command.id %> on_agent_died --ticket TKT-100 --agent bold-turing',
  ]

  static args = {
    event: Args.string({
      description: 'Event name to fire',
      required: true,
      options: ORCHESTRATE_EVENTS,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    ticket: Flags.string({
      description: 'Ticket ID',
      char: 't',
    }),
    pr: Flags.integer({
      description: 'PR number',
    }),
    branch: Flags.string({
      description: 'Branch name',
    }),
    agent: Flags.string({
      description: 'Agent name',
    }),
    action: Flags.string({
      description: 'Action to execute (for direct invocation)',
    }),
    'pr-url': Flags.string({
      description: 'PR URL',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would happen without executing',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(HookFire)
    const jsonMode = shouldOutputJson(flags)
    const parsedFlags = flags as Record<string, unknown>

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('hook fire', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)

    try {
      const ctx: OrchestrateEventContext = {
        event: args.event,
        ticket: parsedFlags.ticket as string | undefined,
        pr: parsedFlags.pr as number | undefined,
        branch: parsedFlags.branch as string | undefined,
        agent: parsedFlags.agent as string | undefined,
        prUrl: parsedFlags['pr-url'] as string | undefined,
      }

      if (parsedFlags['dry-run']) {
        // Show what hooks would fire
        const hooks = db.prepare(
          'SELECT name, event, action_type, action_value, mode FROM pmo_work_hooks WHERE event = ? AND enabled = 1 ORDER BY priority ASC'
        ).all(args.event) as Array<{ name: string; event: string; action_type: string; action_value: string; mode?: string }>

        if (jsonMode) {
          outputSuccessAsJson(
            { event: args.event, hooks, context: ctx, dryRun: true },
            createMetadata('hook fire', flags),
          )
          return
        }

        if (hooks.length === 0) {
          this.log(styles.info(`No hooks configured for event: ${args.event}`))
          return
        }

        this.log(styles.title(`Dry run: ${args.event}`))
        this.log('')
        for (const hook of hooks) {
          const mode = hook.mode || 'auto'
          this.log(`  ${styles.code(hook.name)} ${styles.muted('→')} ${hook.action_value} ${styles.muted(`(${mode})`)}`)
        }
        this.log('')
        this.log(styles.muted(`${hooks.length} hook${hooks.length === 1 ? '' : 's'} would fire`))
        return
      }

      // Create engine and fire event
      const engine = new OrchestrateEngine({
        db,
        log: (msg) => {
          if (!jsonMode) this.log(styles.muted(msg))
        },
      })

      const results = await engine.fireEvent(args.event, ctx)

      if (jsonMode) {
        outputSuccessAsJson(
          { event: args.event, results, context: ctx },
          createMetadata('hook fire', flags),
        )
        return
      }

      if (results.length === 0) {
        this.log(styles.info(`No hooks configured for event: ${args.event}`))
        return
      }

      this.log(styles.title(`Fired: ${args.event}`))
      this.log('')
      for (const result of results) {
        const status = result.skipped
          ? styles.muted('skipped')
          : result.awaitingConfirmation
            ? styles.warning('awaiting confirmation')
            : result.success
              ? styles.success('success')
              : styles.error(`failed: ${result.error}`)
        this.log(`  ${styles.code(result.action)} ${styles.muted('→')} ${status} ${styles.muted(`(${result.durationMs}ms)`)}`)
      }
      this.log('')
    } finally {
      db.close()
    }
  }
}
