import { Args } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class SpecLinkDepends extends PMOCommand {
  static description = 'Add a depends_on dependency (spec requires another to be completed first)'
  static examples = ['<%= config.bin %> <%= command.id %> my-feature other-spec']

  static args = {
    id: Args.string({ description: 'Spec ID that depends on another', required: true }),
    target: Args.string({ description: 'Spec ID that this spec depends on', required: false }),
  }
  static flags = { ...pmoBaseFlags }

  async execute(): Promise<void> {
    const { args } = await this.parse(SpecLinkDepends)

    const spec = await this.storage.getSpec(args.id)
    if (!spec) this.error(`Spec not found: ${args.id}`)

    let targetId = args.target
    if (!targetId) {
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== args.id)
      if (otherSpecs.length === 0) { this.log(styles.muted('\nNo other specs.')); return }
      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select spec that ${args.id} depends on:`,
        choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })) }])
      targetId = selected
    }

    const targetSpec = await this.storage.getSpec(targetId!)
    if (!targetSpec) this.error(`Spec not found: ${targetId}`)

    await this.storage.createSpecDependency(args.id, targetId!, 'depends_on')
    this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} depends on ${styles.emphasis(targetId!)}`))
    this.log(styles.muted(`   ${spec.title} depends on: ${targetSpec.title}`))
  }
}
