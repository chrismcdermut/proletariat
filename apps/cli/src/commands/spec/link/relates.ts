import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class SpecLinkRelates extends Command {
  static description = 'Add a relates_to dependency (informational link)'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Spec ID', required: true }),
    target: Args.string({ description: 'Related spec ID', required: false }),
  }
  static flags = { project: Flags.string({ char: 'P', description: 'Project ID' }) }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkRelates)
    const { storage } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const spec = await storage.getSpec(args.id)
      if (!spec) this.error(`Spec not found: ${args.id}`)

      let targetId = args.target
      if (!targetId) {
        const allSpecs = await storage.listSpecs()
        const otherSpecs = allSpecs.filter(s => s.id !== args.id)
        if (otherSpecs.length === 0) { this.log(styles.muted('\nNo other specs.')); await storage.close(); return }
        const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select spec that ${args.id} relates to:`,
          choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })) }])
        targetId = selected
      }

      const targetSpec = await storage.getSpec(targetId!)
      if (!targetSpec) this.error(`Spec not found: ${targetId}`)

      await storage.createSpecDependency(args.id, targetId!, 'relates_to')
      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} relates to ${styles.emphasis(targetId!)}`))
      await storage.close()
    } catch (error) { await storage.close(); throw error }
  }
}
