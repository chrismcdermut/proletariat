import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'

export default class SpecLink extends PMOCommand {
  static description = 'Manage spec dependencies (links)'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-feature                      # List dependencies',
    '<%= config.bin %> <%= command.id %> my-feature --depends other-spec # my-feature depends on other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --relates other-spec # my-feature relates to other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --duplicates other-spec',
    '<%= config.bin %> <%= command.id %> my-feature --all                # Show all links',
  ]

  static args = {
    id: Args.string({ description: 'Spec ID', required: false }),
  }

  static flags = {
    ...pmoBaseFlags,
    depends: Flags.string({ char: 'd', description: 'Add depends_on dependency' }),
    relates: Flags.string({ char: 'r', description: 'Add relates_to dependency' }),
    duplicates: Flags.string({ description: 'Add duplicates dependency' }),
    all: Flags.boolean({ char: 'a', description: 'Show all dependencies', default: false }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecLink)

    let specId = args.id
    if (!specId) {
      const specs = await this.storage.listSpecs()
      if (specs.length === 0) {
        this.log(styles.muted('\nNo specs found.'))
        return
      }
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select spec to manage dependencies:',
        choices: specs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })),
      }])
      specId = selected
    }

    const spec = await this.storage.getSpec(specId!)
    if (!spec) this.error(`Spec not found: ${specId}`)

    // If a dependency flag is provided, add the dependency directly
    if (flags.depends || flags.relates || flags.duplicates) {
      const targetId = flags.depends || flags.relates || flags.duplicates
      const dependencyType: SpecDependencyType = flags.depends ? 'depends_on' :
                                                  flags.relates ? 'relates_to' : 'duplicates'
      await this.addDependency(specId!, targetId!, dependencyType, spec.title)
      return
    }

    // Interactive mode: show menu in a loop
    let continueLoop = true
    while (continueLoop) {
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== specId)

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: `Dependencies for ${spec.id}:`,
        choices: [
          { name: 'View dependencies', value: 'view' },
          { name: 'Add depends_on dependency', value: 'depends_on' },
          { name: 'Add relates_to dependency', value: 'relates_to' },
          { name: 'Add duplicates dependency', value: 'duplicates' },
          new inquirer.Separator(),
          { name: 'Remove dependency', value: 'remove' },
          { name: 'Done', value: 'done' },
        ],
      }])

      if (action === 'done') {
        continueLoop = false
        continue
      }

      if (action === 'view') {
        await this.viewDependencies(specId!, spec, flags.all)
        continue
      }

      if (action === 'remove') {
        const dependencies = await this.storage.listSpecDependencies(specId!)
        if (dependencies.length === 0) {
          this.log(styles.muted('\nNo dependencies to remove.'))
          continue
        }
        const choices = await Promise.all(dependencies.map(async dep => {
          const depSpec = await this.storage.getSpec(dep.dependsOnSpecId)
          return {
            name: `${dep.dependsOnSpecId} - ${depSpec?.title || 'Unknown'} (${dep.dependencyType})`,
            value: { targetId: dep.dependsOnSpecId, type: dep.dependencyType }
          }
        }))
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select dependency to remove:',
          choices,
        }])
        await this.storage.deleteSpecDependency(specId!, selected.targetId, selected.type)
        this.log(styles.success(`\n✅ Removed dependency: ${specId} → ${selected.targetId}`))
        continue
      }

      // Add dependency
      if (otherSpecs.length === 0) {
        this.log(styles.muted('\nNo other specs to link to.'))
        continue
      }
      const { targetId } = await inquirer.prompt([{
        type: 'list',
        name: 'targetId',
        message: `Select spec that ${specId} ${action === 'depends_on' ? 'depends on' : action === 'relates_to' ? 'relates to' : 'duplicates'}:`,
        choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })),
      }])
      await this.addDependency(specId!, targetId, action as SpecDependencyType, spec.title)
    }
  }

  private async addDependency(
    specId: string,
    targetId: string,
    dependencyType: SpecDependencyType,
    specTitle: string
  ): Promise<void> {
    const targetSpec = await this.storage.getSpec(targetId)
    if (!targetSpec) {
      this.error(`Spec not found: ${targetId}`)
    }

    try {
      await this.storage.createSpecDependency(specId, targetId, dependencyType)

      const typeLabel = dependencyType === 'depends_on' ? 'depends on' :
                        dependencyType === 'relates_to' ? 'relates to' : 'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(specId)} ${typeLabel} ${styles.emphasis(targetId)}`))
      this.log(styles.muted(`   ${specTitle}`))
      this.log(styles.muted(`   ${typeLabel} ${targetSpec.title}`))
    } catch (error) {
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

  private async viewDependencies(
    specId: string,
    spec: { id: string; title: string },
    showAll: boolean
  ): Promise<void> {
    const dependencies = await this.storage.listSpecDependencies(specId)

    this.log(`\n${styles.emphasis(spec.id)}: ${spec.title}`)

    const dependsOn = dependencies.filter(d => d.dependencyType === 'depends_on')
    if (dependsOn.length > 0) {
      this.log(styles.muted('\n  Depends on:'))
      for (const dep of dependsOn) {
        const depSpec = await this.storage.getSpec(dep.dependsOnSpecId)
        if (depSpec) this.log(`    - ${depSpec.id}: ${depSpec.title}`)
      }
    }

    const otherDeps = dependencies.filter(d => d.dependencyType !== 'depends_on')
    if (otherDeps.length > 0) {
      this.log(styles.muted('\n  Related:'))
      for (const dep of otherDeps) {
        const relatedSpec = await this.storage.getSpec(dep.dependsOnSpecId)
        if (relatedSpec) this.log(`    - ${dep.dependencyType}: ${relatedSpec.id} - ${relatedSpec.title}`)
      }
    }

    if (showAll) {
      const allSpecs = await this.storage.listSpecs()
      const dependedBy: Array<{ spec: typeof spec; type: string }> = []
      for (const otherSpec of allSpecs) {
        if (otherSpec.id === specId) continue
        const otherDeps = await this.storage.listSpecDependencies(otherSpec.id)
        const dep = otherDeps.find(d => d.dependsOnSpecId === specId)
        if (dep) dependedBy.push({ spec: otherSpec, type: dep.dependencyType })
      }
      if (dependedBy.length > 0) {
        this.log(styles.muted('\n  Depended by:'))
        for (const { spec: depSpec, type } of dependedBy) this.log(`    - ${depSpec.id}: ${depSpec.title} (${type})`)
      }
    }

    if (dependencies.length === 0) this.log(styles.muted('\n  No dependencies.'))

    this.log('')
  }
}
