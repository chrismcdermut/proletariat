import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'

export default class SpecDependRemove extends Command {
  static description = 'Remove a dependency from a spec'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature other-feature',
    '<%= config.bin %> <%= command.id %> my-feature other-feature --type depends_on',
    '<%= config.bin %> <%= command.id %> my-feature --all',
  ]

  static args = {
    id: Args.string({
      description: 'Spec ID',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Spec ID to remove dependency from',
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
      description: 'Dependency type to remove (removes all types if not specified)',
      options: ['depends_on', 'relates_to', 'duplicates'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all dependencies for this spec',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecDependRemove)

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const specId = args.id

      // Validate spec exists
      const spec = await storage.getSpec(specId)
      if (!spec) {
        this.error(`Spec not found: ${specId}`)
      }

      // Get existing dependencies
      const dependencies = await storage.listSpecDependencies(specId)

      if (dependencies.length === 0) {
        this.log(styles.muted(`\nSpec ${specId} has no dependencies.`))
        await storage.close()
        return
      }

      // If --all flag, remove all dependencies
      if (flags.all) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Remove all ${dependencies.length} dependencies from ${specId}?`,
          default: false,
        }])

        if (!confirmed) {
          this.log(styles.muted('\nCancelled.'))
          await storage.close()
          return
        }

        for (const dep of dependencies) {
          await storage.deleteSpecDependency(specId, dep.dependsOnSpecId, dep.dependencyType)
        }

        await storage.close()

        this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${specId}`))
        return
      }

      let dependsOnId = args['depends-on']

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const choices = await Promise.all(dependencies.map(async (dep) => {
          const depSpec = await storage.getSpec(dep.dependsOnSpecId)
          return {
            name: `${dep.dependsOnSpecId} - ${depSpec?.title || 'Unknown'} (${dep.dependencyType})`,
            value: dep.dependsOnSpecId,
          }
        }))

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select dependency to remove:',
          choices,
        }])
        dependsOnId = selected
      }

      // Find the dependency
      const dep = dependencies.find(d => d.dependsOnSpecId === dependsOnId)
      if (!dep) {
        this.error(`No dependency found from ${specId} to ${dependsOnId}`)
      }

      // Remove specific dependency
      const dependencyType = flags.type as SpecDependencyType | undefined
      await storage.deleteSpecDependency(specId, dependsOnId!, dependencyType)

      await storage.close()

      const depSpec = await storage.getSpec(dependsOnId!)
      this.log(styles.success(`\n✅ Removed dependency: ${specId} → ${dependsOnId}`))
      if (depSpec) {
        this.log(styles.muted(`   ${spec.title} no longer depends on ${depSpec.title}`))
      }

    } catch (error) {
      await storage.close()
      throw error
    }
  }
}
