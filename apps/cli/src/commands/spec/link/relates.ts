import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

export default class SpecLinkRelates extends PMOCommand {
  static description = 'Add a relates_to dependency (informational link)'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Spec ID', required: true }),
    target: Args.string({ description: 'Related spec ID', required: false }),
  }
  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkRelates)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec link relates', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const spec = await this.storage.getSpec(args.id)
    if (!spec) return handleError('SPEC_NOT_FOUND', `Spec not found: ${args.id}`)

    let targetId = args.target
    if (!targetId) {
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== args.id)
      if (otherSpecs.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_SPECS', 'No other specs.', createMetadata('spec link relates', flags))
          return
        }
        this.log(styles.muted('\nNo other specs.'))
        return
      }

      // In JSON mode, output spec selection prompt
      if (jsonMode) {
        const specChoices = otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'target', `Select spec that ${args.id} relates to:`, specChoices),
          createMetadata('spec link relates', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select spec that ${args.id} relates to:`,
        choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })) }])
      targetId = selected
    }

    const targetSpec = await this.storage.getSpec(targetId!)
    if (!targetSpec) this.error(`Spec not found: ${targetId}`)

    await this.storage.createSpecDependency(args.id, targetId!, 'relates_to')
    this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} relates to ${styles.emphasis(targetId!)}`))
  }
}
