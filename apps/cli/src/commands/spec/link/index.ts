import { Args, Command, Flags } from '@oclif/core'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'

export default class SpecLink extends Command {
  static description = 'Manage spec dependencies (links)'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature                      # List dependencies',
    '<%= config.bin %> <%= command.id %> my-feature --depends other-spec # my-feature depends on other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --relates other-spec # my-feature relates to other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --duplicates other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --all                # Show all links',
  ]

  static args = {
    id: Args.string({ description: 'Spec ID', required: true }),
  }

  static flags = {
    project: Flags.string({ char: 'P', description: 'Project ID' }),
    depends: Flags.string({ char: 'd', description: 'Add depends_on dependency' }),
    relates: Flags.string({ char: 'r', description: 'Add relates_to dependency' }),
    duplicates: Flags.string({ description: 'Add duplicates dependency' }),
    all: Flags.boolean({ char: 'a', description: 'Show all dependencies', default: false }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecLink)
    const { storage } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const spec = await storage.getSpec(args.id)
      if (!spec) this.error(`Spec not found: ${args.id}`)

      // If a dependency flag is provided, add the dependency
      if (flags.depends || flags.relates || flags.duplicates) {
        const targetId = flags.depends || flags.relates || flags.duplicates
        const dependencyType: SpecDependencyType = flags.depends ? 'depends_on' :
                                                    flags.relates ? 'relates_to' : 'duplicates'

        const targetSpec = await storage.getSpec(targetId!)
        if (!targetSpec) this.error(`Spec not found: ${targetId}`)

        try {
          await storage.createSpecDependency(args.id, targetId!, dependencyType)
          const typeLabel = dependencyType === 'depends_on' ? 'depends on' :
                            dependencyType === 'relates_to' ? 'relates to' : 'duplicates'
          this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} ${typeLabel} ${styles.emphasis(targetId!)}`))
          this.log(styles.muted(`   ${spec.title} ${typeLabel} ${targetSpec.title}`))
        } catch (error) {
          if (error instanceof Error && error.message.includes('already exists')) this.error('Dependency already exists')
          if (error instanceof Error && error.message.includes('self-dependency')) this.error('Cannot create self-dependency')
          throw error
        }
        await storage.close(); return
      }

      // Otherwise, list dependencies
      const dependencies = await storage.listSpecDependencies(args.id)
      this.log(`\n${styles.emphasis(spec.id)}: ${spec.title}`)

      const dependsOn = dependencies.filter(d => d.dependencyType === 'depends_on')
      if (dependsOn.length > 0) {
        this.log(styles.muted('\n  Depends on:'))
        for (const dep of dependsOn) {
          const depSpec = await storage.getSpec(dep.dependsOnSpecId)
          if (depSpec) this.log(`    - ${depSpec.id}: ${depSpec.title}`)
        }
      }

      const otherDeps = dependencies.filter(d => d.dependencyType !== 'depends_on')
      if (otherDeps.length > 0) {
        this.log(styles.muted('\n  Related:'))
        for (const dep of otherDeps) {
          const relatedSpec = await storage.getSpec(dep.dependsOnSpecId)
          if (relatedSpec) this.log(`    - ${dep.dependencyType}: ${relatedSpec.id} - ${relatedSpec.title}`)
        }
      }

      if (flags.all) {
        const allSpecs = await storage.listSpecs()
        const dependedBy: Array<{ spec: typeof spec; type: string }> = []
        for (const otherSpec of allSpecs) {
          if (otherSpec.id === args.id) continue
          const otherDeps = await storage.listSpecDependencies(otherSpec.id)
          const dep = otherDeps.find(d => d.dependsOnSpecId === args.id)
          if (dep) dependedBy.push({ spec: otherSpec, type: dep.dependencyType })
        }
        if (dependedBy.length > 0) {
          this.log(styles.muted('\n  Depended by:'))
          for (const { spec: depSpec, type } of dependedBy) this.log(`    - ${depSpec.id}: ${depSpec.title} (${type})`)
        }
      }

      if (dependencies.length === 0) this.log(styles.muted('\n  No dependencies.'))
      this.log('')
      await storage.close()
    } catch (error) { await storage.close(); throw error }
  }
}
