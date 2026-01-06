import { Args, Command, Flags } from '@oclif/core'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class SpecDepend extends Command {
  static description = 'List dependencies for a spec'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature',
    '<%= config.bin %> <%= command.id %> my-feature --all',
  ]

  static args = {
    id: Args.string({
      description: 'Spec ID',
      required: true,
    }),
  }

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show all dependencies (depends on and depended by)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecDepend)

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const spec = await storage.getSpec(args.id)
      if (!spec) {
        this.error(`Spec not found: ${args.id}`)
      }

      // Get dependencies
      const dependencies = await storage.listSpecDependencies(args.id)

      this.log(`\n${styles.emphasis(spec.id)}: ${spec.title}`)

      // Show depends_on dependencies
      const dependsOn = dependencies.filter(d => d.dependencyType === 'depends_on')
      if (dependsOn.length > 0) {
        this.log(styles.muted('\n  Depends on:'))
        for (const dep of dependsOn) {
          const depSpec = await storage.getSpec(dep.dependsOnSpecId)
          if (depSpec) {
            this.log(`    - ${depSpec.id}: ${depSpec.title}`)
          }
        }
      }

      // Show other dependency types
      const otherDeps = dependencies.filter(d => d.dependencyType !== 'depends_on')
      if (otherDeps.length > 0) {
        this.log(styles.muted('\n  Related:'))
        for (const dep of otherDeps) {
          const relatedSpec = await storage.getSpec(dep.dependsOnSpecId)
          if (relatedSpec) {
            this.log(`    - ${dep.dependencyType}: ${relatedSpec.id} - ${relatedSpec.title}`)
          }
        }
      }

      // Optionally show specs that depend on this spec
      if (flags.all) {
        const allSpecs = await storage.listSpecs()
        const dependedBy: Array<{ spec: typeof spec; type: string }> = []

        for (const otherSpec of allSpecs) {
          if (otherSpec.id === args.id) continue
          const otherDeps = await storage.listSpecDependencies(otherSpec.id)
          const dependingDep = otherDeps.find(d => d.dependsOnSpecId === args.id)
          if (dependingDep) {
            dependedBy.push({ spec: otherSpec, type: dependingDep.dependencyType })
          }
        }

        if (dependedBy.length > 0) {
          this.log(styles.muted('\n  Depended by:'))
          for (const { spec: depSpec, type } of dependedBy) {
            this.log(`    - ${depSpec.id}: ${depSpec.title} (${type})`)
          }
        }
      }

      if (dependencies.length === 0) {
        this.log(styles.muted('\n  No dependencies.'))
      }

      this.log('')
      await storage.close()
    } catch (error) {
      await storage.close()
      throw error
    }
  }
}
