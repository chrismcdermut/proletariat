/**
 * prlt poke <agent> <message> — send message to agent
 *
 * PRLT-1263: Delegates to `session poke` so all poke entry-points
 * share the same unified session resolution path.
 */

import { Args } from '@oclif/core'
import { PromptCommand } from '../lib/prompt-command.js'
import { machineOutputFlags } from '../lib/pmo/index.js'

export default class Poke extends PromptCommand {
  static description = 'Send a message to a running agent (delegates to session poke)'

  static examples = [
    '<%= config.bin %> poke bold-fox "focus on the login bug"',
    '<%= config.bin %> poke bold-fox "yes"',
    '<%= config.bin %> poke SES-ABC123 "approved"',
  ]

  static args = {
    agent: Args.string({
      description: 'Agent name or session ID',
      required: true,
    }),
    message: Args.string({
      description: 'Message to send to the agent',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Poke)

    const pokeArgs: string[] = [args.agent]
    if (args.message) {
      pokeArgs.push(args.message)
    }
    if (flags.json) {
      pokeArgs.push('--json')
    }

    await this.config.runCommand('session:poke', pokeArgs)
  }
}
