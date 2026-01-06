import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { EpicDependencyType } from '../../../lib/pmo/types.js'

export default class EpicDependRemove extends Command {
  static description = 'Remove a dependency from an epic'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002 --type blocks',
    '<%= config.bin %> <%= command.id %> EPIC-001 --all',
  ]

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Epic ID to remove dependency from',
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
      options: ['blocks', 'relates_to', 'duplicates'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all dependencies for this epic',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicDependRemove)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const epicId = args.id

      // Validate epic exists
      const epic = await storage.getEpic(epicId)
      if (!epic) {
        this.error(`Epic not found: ${epicId}`)
      }

      // Get existing dependencies
      const dependencies = await storage.listEpicDependencies(epicId)

      if (dependencies.length === 0) {
        this.log(styles.muted(`\nEpic ${epicId} has no dependencies.`))
        await storage.close()
        return
      }

      // If --all flag, remove all dependencies
      if (flags.all) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Remove all ${dependencies.length} dependencies from ${epicId}?`,
          default: false,
        }])

        if (!confirmed) {
          this.log(styles.muted('\nCancelled.'))
          await storage.close()
          return
        }

        for (const dep of dependencies) {
          await storage.deleteEpicDependency(epicId, dep.dependsOnEpicId, dep.dependencyType)
        }

        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
        await storage.close()

        this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${epicId}`))
        return
      }

      let dependsOnId = args['depends-on']

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const choices = await Promise.all(dependencies.map(async (dep) => {
          const depEpic = await storage.getEpic(dep.dependsOnEpicId)
          return {
            name: `${dep.dependsOnEpicId} - ${depEpic?.title || 'Unknown'} (${dep.dependencyType})`,
            value: dep.dependsOnEpicId,
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
      const dep = dependencies.find(d => d.dependsOnEpicId === dependsOnId)
      if (!dep) {
        this.error(`No dependency found from ${epicId} to ${dependsOnId}`)
      }

      // Remove specific dependency
      const dependencyType = flags.type as EpicDependencyType | undefined
      await storage.deleteEpicDependency(epicId, dependsOnId!, dependencyType)

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

      const depEpic = await storage.getEpic(dependsOnId!)
      this.log(styles.success(`\n✅ Removed dependency: ${epicId} → ${dependsOnId}`))
      if (depEpic) {
        this.log(styles.muted(`   ${epic.title} no longer depends on ${depEpic.title}`))
      }

    } catch (error) {
      await storage.close()
      throw error
    }
  }
}
