import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { SpecDependencyType } from '../../../lib/pmo/types.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    depends: Flags.string({ char: 'd', description: 'Add depends_on dependency' }),
    relates: Flags.string({ char: 'r', description: 'Add relates_to dependency' }),
    duplicates: Flags.string({ description: 'Add duplicates dependency' }),
    all: Flags.boolean({ char: 'a', description: 'Show all dependencies', default: false }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecLink)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    let specId = args.id
    if (!specId) {
      const specs = await this.storage.listSpecs()
      if (specs.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_SPECS', 'No specs found.', createMetadata('spec link', flags))
          return
        }
        this.log(styles.muted('\nNo specs found.'))
        return
      }

      // In JSON mode, output spec selection prompt
      if (jsonMode) {
        const specChoices = specs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select spec to manage dependencies:', specChoices),
          createMetadata('spec link', flags)
        )
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
      // eslint-disable-next-line no-await-in-loop -- Interactive user loop
      const allSpecs = await this.storage.listSpecs()
      const otherSpecs = allSpecs.filter(s => s.id !== specId)

      // eslint-disable-next-line no-await-in-loop -- Interactive user prompt
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
        // eslint-disable-next-line no-await-in-loop -- User action handling
        await this.viewDependencies(specId!, spec, flags.all)
        continue
      }

      if (action === 'remove') {
        // eslint-disable-next-line no-await-in-loop -- User action handling
        const dependencies = await this.storage.listSpecDependencies(specId!)
        if (dependencies.length === 0) {
          this.log(styles.muted('\nNo dependencies to remove.'))
          continue
        }
        // eslint-disable-next-line no-await-in-loop -- Building choices for current interaction
        const choices = await Promise.all(dependencies.map(async dep => {
          const depSpec = await this.storage.getSpec(dep.dependsOnSpecId)
          return {
            name: `${dep.dependsOnSpecId} - ${depSpec?.title || 'Unknown'} (${dep.dependencyType})`,
            value: { targetId: dep.dependsOnSpecId, type: dep.dependencyType }
          }
        }))
        // eslint-disable-next-line no-await-in-loop -- User selection prompt
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select dependency to remove:',
          choices,
        }])
        // eslint-disable-next-line no-await-in-loop -- Action after user selection
        await this.storage.deleteSpecDependency(specId!, selected.targetId, selected.type)
        this.log(styles.success(`\n✅ Removed dependency: ${specId} → ${selected.targetId}`))
        continue
      }

      // Add dependency
      if (otherSpecs.length === 0) {
        this.log(styles.muted('\nNo other specs to link to.'))
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- User selection prompt
      const { targetId } = await inquirer.prompt([{
        type: 'list',
        name: 'targetId',
        message: `Select spec that ${specId} ${action === 'depends_on' ? 'depends on' : action === 'relates_to' ? 'relates to' : 'duplicates'}:`,
        choices: otherSpecs.map(s => ({ name: `${s.id} - ${s.title}`, value: s.id })),
      }])
      // eslint-disable-next-line no-await-in-loop -- Action after user selection
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
      // Fetch all dependency specs in parallel
      const depSpecs = await Promise.all(
        dependsOn.map(dep => this.storage.getSpec(dep.dependsOnSpecId))
      )
      for (const depSpec of depSpecs) {
        if (depSpec) this.log(`    - ${depSpec.id}: ${depSpec.title}`)
      }
    }

    const otherDeps = dependencies.filter(d => d.dependencyType !== 'depends_on')
    if (otherDeps.length > 0) {
      this.log(styles.muted('\n  Related:'))
      // Fetch all related specs in parallel
      const relatedSpecs = await Promise.all(
        otherDeps.map(async dep => ({ dep, spec: await this.storage.getSpec(dep.dependsOnSpecId) }))
      )
      for (const { dep, spec: relatedSpec } of relatedSpecs) {
        if (relatedSpec) this.log(`    - ${dep.dependencyType}: ${relatedSpec.id} - ${relatedSpec.title}`)
      }
    }

    if (showAll) {
      const allSpecs = await this.storage.listSpecs()
      // Find all specs that depend on this spec in parallel
      const dependedByResults = await Promise.all(
        allSpecs
          .filter(otherSpec => otherSpec.id !== specId)
          .map(async otherSpec => {
            const otherDeps = await this.storage.listSpecDependencies(otherSpec.id)
            const dep = otherDeps.find(d => d.dependsOnSpecId === specId)
            return dep ? { spec: otherSpec, type: dep.dependencyType } : null
          })
      )
      const dependedBy = dependedByResults.filter((d): d is NonNullable<typeof d> => d !== null)
      if (dependedBy.length > 0) {
        this.log(styles.muted('\n  Depended by:'))
        for (const item of dependedBy) this.log(`    - ${item.spec.id}: ${item.spec.title} (${item.type})`)
      }
    }

    if (dependencies.length === 0) this.log(styles.muted('\n  No dependencies.'))

    this.log('')
  }
}
