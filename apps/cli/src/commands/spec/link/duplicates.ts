import { Args } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class SpecLinkDuplicates extends PMOCommand {
  static description = 'Mark a spec as duplicate of another'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Duplicate spec ID', required: true }),
    original: Args.string({ description: 'Original spec ID', required: false }),
  }
  static flags = { ...pmoBaseFlags }

  async execute(): Promise<void> {
    const { args } = await this.parse(SpecLinkDuplicates)

    const spec = await this.storage.getSpec(args.id)
    if (!spec) this.error(`Spec not found: ${args.id}`)

    let originalId = args.original
    if (!originalId) {
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== args.id)
      if (otherSpecs.length === 0) { this.log(styles.muted('\nNo other specs.')); return }
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
