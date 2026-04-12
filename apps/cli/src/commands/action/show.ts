/**
 * prlt action show <id> — Show details for a specific work action.
 */

import { Args } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class ActionShow extends PMOCommand {
  static description = 'Show details for a specific work action'

  static examples = [
    '<%= config.bin %> action show implement',
    '<%= config.bin %> action show test',
  ]

  static args = {
    id: Args.string({
      description: 'Action ID to show',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionShow)
    const jsonMode = shouldOutputJson(flags)

    const action = await this.storage.getAction(args.id)

    if (!action) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Action not found: ${args.id}`, createMetadata('action show', flags))
        return
      }
      this.error(`Action not found: ${args.id}`)
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          action: {
            id: action.id,
            name: action.name,
            description: action.description || null,
            prompt: action.prompt,
            endPrompt: action.endPrompt || null,
            toIntent: action.toIntent,
            fromIntent: action.fromIntent || null,
            executor: action.executor || null,
            environment: action.environment || null,
            permissionMode: action.permissionMode || null,
            timeout: action.timeout || null,
            model: action.model || null,
            reviewGate: action.reviewGate || null,
            modifiesCode: action.modifiesCode,
            isDefault: action.isDefault,
            isBuiltin: action.isBuiltin,
            createdAt: action.createdAt.toISOString(),
          },
        },
        createMetadata('action show', flags),
      )
      return
    }

    this.log(styles.title(action.name))
    this.log('')
    this.log(`  ${styles.emphasis('ID:')}              ${action.id}`)
    this.log(`  ${styles.emphasis('Type:')}            ${action.isBuiltin ? 'Built-in' : 'Custom'}`)
    if (action.description) {
      this.log(`  ${styles.emphasis('Description:')}     ${action.description}`)
    }
    this.log('')
    this.log(`  ${styles.emphasis('To Intent:')}       ${action.toIntent || styles.muted('(none)')}`)
    this.log(`  ${styles.emphasis('From Intent:')}     ${action.fromIntent || styles.muted('(any / manual only)')}`)
    this.log(`  ${styles.emphasis('Executor:')}        ${action.executor || styles.muted('(inherits workspace default)')}`)
    if (action.environment) {
      this.log(`  ${styles.emphasis('Environment:')}    ${action.environment}`)
    }
    if (action.permissionMode) {
      this.log(`  ${styles.emphasis('Permissions:')}    ${action.permissionMode}`)
    }
    if (action.timeout) {
      this.log(`  ${styles.emphasis('Timeout:')}        ${action.timeout}s`)
    }
    if (action.model) {
      this.log(`  ${styles.emphasis('Model:')}          ${action.model}`)
    }
    if (action.reviewGate) {
      this.log(`  ${styles.emphasis('Review Gate:')}    ${action.reviewGate}`)
    }
    this.log(`  ${styles.emphasis('Modifies Code:')}  ${action.modifiesCode ? 'Yes' : 'No'}`)
    if (action.isDefault) {
      this.log(`  ${styles.emphasis('Default:')}        ${styles.success('Yes')}`)
    }
    this.log('')
    this.log(`  ${styles.emphasis('Prompt:')}`)
    this.log(`  ${styles.muted(action.prompt.substring(0, 200))}${action.prompt.length > 200 ? '...' : ''}`)
  }
}
