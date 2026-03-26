/**
 * Work Propose Command (PRLT-1129)
 *
 * Agent-friendly shorthand for `prlt work ready <ticketId> --pr`.
 * Creates a PR and moves the ticket to Review in one step.
 *
 * This is the primary way agents should finalize their work.
 * The stop hook uses it as a safety net for agents that exit without proposing.
 */

import { Args } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class WorkPropose extends PMOCommand {
  static description = 'Propose work for review — creates a PR and moves ticket to Review'

  static examples = [
    '<%= config.bin %> work propose TKT-001',
    '<%= config.bin %> work propose          # Auto-detects ticket from branch or running execution',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID — auto-detected from branch or execution if omitted',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkPropose)
    const jsonMode = shouldOutputJson(flags)

    // Build args for work:ready --pr
    const readyArgs: string[] = []
    if (args.ticketId) {
      readyArgs.push(args.ticketId)
    }
    readyArgs.push('--pr')

    // Forward project flag if provided
    const projectId = (flags as { project?: string }).project
    if (projectId) {
      readyArgs.push('--project', projectId)
    }

    if (jsonMode) {
      readyArgs.push('--json')
    }

    try {
      await this.config.runCommand('work:ready', readyArgs)
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson(
          'PROPOSE_FAILED',
          `Failed to propose work: ${error instanceof Error ? error.message : error}`,
          createMetadata('work propose', flags)
        )
        return
      }
      throw error
    }
  }
}
