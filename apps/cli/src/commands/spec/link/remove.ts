import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'

export default class SpecLinkRemove extends Command {
  static description = 'Remove a dependency from a spec'
  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --all',
  ]

  static args = {
    id: Args.string({ description: 'Spec ID', required: true }),
    target: Args.string({ description: 'Target spec ID to unlink', required: false }),
  }
  static flags = {
    project: Flags.string({ char: 'P', description: 'Project ID' }),
    type: Flags.string({ char: 't', description: 'Dependency type', options: ['depends_on', 'relates_to', 'duplicates'] }),
    all: Flags.boolean({ char: 'a', description: 'Remove all dependencies', default: false }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkRemove)
    const { storage } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const spec = await storage.getSpec(args.id)
      if (!spec) this.error(`Spec not found: ${args.id}`)

      const dependencies = await storage.listSpecDependencies(args.id)
      if (dependencies.length === 0) { this.log(styles.muted(`\nSpec ${args.id} has no dependencies.`)); await storage.close(); return }

      if (flags.all) {
        const { confirmed } = await inquirer.prompt([{ type: 'confirm', name: 'confirmed', message: `Remove all ${dependencies.length} dependencies?`, default: false }])
        if (!confirmed) { this.log(styles.muted('\nCancelled.')); await storage.close(); return }
        for (const dep of dependencies) await storage.deleteSpecDependency(args.id, dep.dependsOnSpecId, dep.dependencyType)
        this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${args.id}`))
        await storage.close(); return
      }

      let targetId = args.target
      if (!targetId) {
        const choices = await Promise.all(dependencies.map(async dep => {
          const depSpec = await storage.getSpec(dep.dependsOnSpecId)
          return { name: `${dep.dependsOnSpecId} - ${depSpec?.title || 'Unknown'} (${dep.dependencyType})`, value: dep.dependsOnSpecId }
        }))
        const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: 'Select dependency to remove:', choices }])
        targetId = selected
      }

      await storage.deleteSpecDependency(args.id, targetId!, flags.type as SpecDependencyType | undefined)
      this.log(styles.success(`\n✅ Removed dependency: ${args.id} → ${targetId}`))
      await storage.close()
    } catch (error) { await storage.close(); throw error }
  }
}
