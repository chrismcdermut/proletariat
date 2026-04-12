/**
 * prlt action create <name> — Create a new work action with intent-based wiring.
 */

import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class ActionCreate extends PMOCommand {
  static description = 'Create a new work action with intent-based wiring'

  static examples = [
    '<%= config.bin %> action create test --to-intent testing --prompt "Run tests for this ticket"',
    '<%= config.bin %> action create deploy --to-intent completed --from-intent needs_review --prompt "Deploy to production"',
    '<%= config.bin %> action create hotfix --to-intent started --executor claude --prompt "Fix the bug"',
  ]

  static args = {
    name: Args.string({
      description: 'Action name (used as identifier)',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    'to-intent': Flags.string({
      description: 'Target intent after action completes (required)',
      required: true,
    }),
    'from-intent': Flags.string({
      description: 'Intent that triggers this action automatically (optional — omit for manual-only)',
    }),
    prompt: Flags.string({
      description: 'Instruction prompt sent to the agent (required)',
      required: true,
    }),
    'end-prompt': Flags.string({
      description: 'Completion instructions sent to the agent',
    }),
    executor: Flags.string({
      description: 'Executor override (null inherits workspace default)',
      options: ['claude', 'codex', 'opencode', 'custom'],
    }),
    environment: Flags.string({
      description: 'Execution environment',
      options: ['devcontainer', 'docker', 'host', 'vm'],
    }),
    description: Flags.string({
      description: 'Human-readable description of the action',
    }),
    default: Flags.boolean({
      description: 'Make this the default action for its from_intent',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionCreate)
    const jsonMode = shouldOutputJson(flags)

    try {
      const action = await this.storage.createAction({
        name: args.name,
        prompt: flags.prompt,
        toIntent: flags['to-intent'],
        fromIntent: flags['from-intent'] || undefined,
        endPrompt: flags['end-prompt'] || undefined,
        executor: (flags.executor as 'claude' | 'codex' | 'opencode' | 'custom') || undefined,
        environment: (flags.environment as 'devcontainer' | 'docker' | 'host' | 'vm') || undefined,
        description: flags.description || undefined,
        isDefault: flags.default,
      })

      if (jsonMode) {
        outputSuccessAsJson(
          {
            action: {
              id: action.id,
              name: action.name,
              toIntent: action.toIntent,
              fromIntent: action.fromIntent || null,
              executor: action.executor || null,
              environment: action.environment || null,
              prompt: action.prompt,
              endPrompt: action.endPrompt || null,
              description: action.description || null,
              isDefault: action.isDefault,
            },
          },
          createMetadata('action create', flags),
        )
        return
      }

      this.log(styles.success(`Action "${action.name}" created (${action.id})`))
      this.log('')
      this.log(`  ${styles.emphasis('To Intent:')}     ${action.toIntent}`)
      if (action.fromIntent) {
        this.log(`  ${styles.emphasis('From Intent:')}   ${action.fromIntent}`)
      }
      if (action.executor) {
        this.log(`  ${styles.emphasis('Executor:')}      ${action.executor}`)
      } else {
        this.log(`  ${styles.emphasis('Executor:')}      ${styles.muted('(inherits workspace default)')}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('ACTION_CREATE_FAILED', message, createMetadata('action create', flags))
        return
      }
      this.error(message)
    }
  }
}
