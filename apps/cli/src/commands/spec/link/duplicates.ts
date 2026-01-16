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

export default class SpecLinkDuplicates extends PMOCommand {
  static description = 'Mark a spec as duplicate of another'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Duplicate spec ID', required: true }),
    original: Args.string({ description: 'Original spec ID', required: false }),
  }
  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkDuplicates)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec link duplicates', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const spec = await this.storage.getSpec(args.id)
    if (!spec) return handleError('SPEC_NOT_FOUND', `Spec not found: ${args.id}`)

    let originalId = args.original
    if (!originalId) {
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== args.id)
      if (otherSpecs.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_SPECS', 'No other specs.', createMetadata('spec link duplicates', flags))
          return
        }
        this.log(styles.muted('\nNo other specs.'))
        return
      }

      // In JSON mode, output spec selection prompt
      if (jsonMode) {
        const specChoices = otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'original', `Select the original spec (${args.id} is a duplicate of):`, specChoices),
          createMetadata('spec link duplicates', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select the original spec (${args.id} is a duplicate of):`,
        choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })) }])
      originalId = selected
    }

    const originalSpec = await this.storage.getSpec(originalId!)
    if (!originalSpec) this.error(`Spec not found: ${originalId}`)

    await this.storage.createSpecDependency(args.id, originalId!, 'duplicates')
    this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
  }
}
