/**
 * prlt action create — Create a custom work action with intent-based wiring.
 *
 * Example:
 *   prlt action create test --to-intent testing --prompt 'Run test suite...'
 *   prlt action create deploy --to-intent completed --from-intent needs_review --executor codex
 */

import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import type { ActionExecutor, ActionEnvironment, ActionPermissionMode, ReviewGateMode } from '../../lib/pmo/types.js'
import { styles } from '../../lib/styles.js'

export default class ActionCreate extends PMOCommand {
  static description = 'Create a custom work action with intent-based wiring'

  static examples = [
    '<%= config.bin %> action create test --to-intent testing --prompt "Run test suite and report results"',
    '<%= config.bin %> action create deploy --to-intent completed --from-intent needs_review --executor codex',
    '<%= config.bin %> action create qa --to-intent testing --from-intent needs_review --prompt "Run QA checks" --environment docker',
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
      description: 'Target intent after action completes (e.g., started, needs_review, completed, testing)',
      required: true,
    }),
    'from-intent': Flags.string({
      description: 'Intent that triggers this action automatically (optional — manual-only if omitted)',
    }),
    prompt: Flags.string({
      description: 'The prompt/instruction sent to the agent',
      required: true,
    }),
    'end-prompt': Flags.string({
      description: 'Completion instructions sent to the agent when done',
    }),
    description: Flags.string({
      description: 'Human-readable description of what the action does',
    }),
    executor: Flags.string({
      description: 'Executor override (inherits workspace default if omitted)',
      options: ['claude', 'codex', 'opencode', 'custom'],
    }),
    environment: Flags.string({
      description: 'Execution environment',
      options: ['devcontainer', 'docker', 'host', 'vm'],
    }),
    'permission-mode': Flags.string({
      description: 'Permission mode for the agent',
      options: ['full', 'readonly', 'bypassPermissions'],
    }),
    'review-gate': Flags.string({
      description: 'Review gate mode',
      options: ['required', 'auto', 'post'],
    }),
    'modifies-code': Flags.boolean({
      description: 'Whether this action modifies code (needs a branch)',
      default: true,
      allowNo: true,
    }),
    default: Flags.boolean({
      description: 'Set as the default action for its from_intent',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionCreate)
    const jsonMode = shouldOutputJson(flags)

    try {
      const action = await this.storage.createAction({
        name: args.name,
        description: flags.description,
        prompt: flags.prompt,
        endPrompt: flags['end-prompt'],
        toIntent: flags['to-intent'],
        fromIntent: flags['from-intent'] || undefined,
        executor: (flags.executor as ActionExecutor) || undefined,
        environment: (flags.environment as ActionEnvironment) || undefined,
        permissionMode: (flags['permission-mode'] as ActionPermissionMode) || undefined,
        reviewGate: (flags['review-gate'] as ReviewGateMode) || undefined,
        modifiesCode: flags['modifies-code'],
        isDefault: flags.default,
      })

      if (jsonMode) {
        this.logJson({
          success: true,
          action: {
            id: action.id,
            name: action.name,
            toIntent: action.toIntent,
            fromIntent: action.fromIntent,
            executor: action.executor,
          },
        })
      } else {
        this.log(styles.success(`Created action: ${action.name} (${action.id})`))
        this.log(styles.muted(`  to_intent:   ${action.toIntent || '(none)'}`))
        this.log(styles.muted(`  from_intent: ${action.fromIntent || '(none — manual only)'}`))
        this.log(styles.muted(`  executor:    ${action.executor || '(workspace default)'}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('ACTION_CREATE_FAILED', message, createMetadata('action-create', flags))
      } else {
        this.error(message)
      }
    }
  }
}
