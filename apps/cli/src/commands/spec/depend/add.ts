import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'

export default class SpecDependAdd extends Command {
  static description = 'Add a dependency to a spec'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature other-feature',
    '<%= config.bin %> <%= command.id %> my-feature other-feature --type depends_on',
    '<%= config.bin %> <%= command.id %> my-feature other-feature --type relates_to',
  ]

  static args = {
    id: Args.string({
      description: 'Spec ID that will have the dependency',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Spec ID that this spec depends on',
      required: false,
    }),
  }

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    type: Flags.string({
      char: 't',
      description: 'Dependency type',
      options: ['depends_on', 'relates_to', 'duplicates'],
      default: 'depends_on',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecDependAdd)

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const specId = args.id
      let dependsOnId = args['depends-on']

      // Validate source spec exists
      const spec = await storage.getSpec(specId)
      if (!spec) {
        this.error(`Spec not found: ${specId}`)
      }

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const allSpecs = await storage.listSpecs()
        const otherSpecs = allSpecs.filter(s => s.id !== specId)

        if (otherSpecs.length === 0) {
          this.log(styles.muted('\nNo other specs to create dependency with.'))
          await storage.close()
          return
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select spec that ${specId} depends on:`,
          choices: otherSpecs.map(s => ({
            name: `${s.id} - ${s.title}`,
            value: s.id,
          })),
        }])
        dependsOnId = selected
      }

      // Validate target spec exists
      const dependsOnSpec = await storage.getSpec(dependsOnId!)
      if (!dependsOnSpec) {
        this.error(`Spec not found: ${dependsOnId}`)
      }

      // Create the dependency
      const dependencyType = flags.type as SpecDependencyType

      await storage.createSpecDependency(specId, dependsOnId!, dependencyType)
      await storage.close()

      const typeLabel = dependencyType === 'depends_on' ? 'depends on' :
                        dependencyType === 'relates_to' ? 'relates to' :
                        'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(specId)} ${typeLabel} ${styles.emphasis(dependsOnId!)}`))
      this.log(styles.muted(`   ${spec.title}`))
      this.log(styles.muted(`   ${typeLabel} ${dependsOnSpec.title}`))

    } catch (error) {
      await storage.close()
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this.error('Dependency already exists')
        }
        if (error.message.includes('self-dependency')) {
          this.error('Cannot create self-dependency')
        }
      }
      throw error
    }
  }
}
