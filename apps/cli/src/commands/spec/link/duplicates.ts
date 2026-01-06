import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class SpecLinkDuplicates extends Command {
  static description = 'Mark a spec as duplicate of another'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Duplicate spec ID', required: true }),
    original: Args.string({ description: 'Original spec ID', required: false }),
  }
  static flags = { project: Flags.string({ char: 'P', description: 'Project ID' }) }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkDuplicates)
    const { storage } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const spec = await storage.getSpec(args.id)
      if (!spec) this.error(`Spec not found: ${args.id}`)

      let originalId = args.original
      if (!originalId) {
        const allSpecs = await storage.listSpecs()
        const otherSpecs = allSpecs.filter(s => s.id !== args.id)
        if (otherSpecs.length === 0) { this.log(styles.muted('\nNo other specs.')); await storage.close(); return }
        const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select the original spec (${args.id} is a duplicate of):`,
          choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })) }])
        originalId = selected
      }

      const originalSpec = await storage.getSpec(originalId!)
      if (!originalSpec) this.error(`Spec not found: ${originalId}`)

      await storage.createSpecDependency(args.id, originalId!, 'duplicates')
      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
      await storage.close()
    } catch (error) { await storage.close(); throw error }
  }
}
