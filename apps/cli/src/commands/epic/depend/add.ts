import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { EpicDependencyType } from '../../../lib/pmo/types.js'

export default class EpicDependAdd extends Command {
  static description = 'Add a dependency to an epic'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002 --type blocks',
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002 --type relates_to',
    '<%= config.bin %> <%= command.id %> EPIC-001 --blocks EPIC-002',
  ]

  static args = {
    id: Args.string({
      description: 'Epic ID that will have the dependency',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Epic ID that this epic depends on',
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
      options: ['blocks', 'relates_to', 'duplicates'],
      default: 'blocks',
    }),
    blocks: Flags.string({
      char: 'b',
      description: 'Shorthand: epic ID that blocks this epic',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicDependAdd)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const epicId = args.id
      let dependsOnId = args['depends-on'] || flags.blocks

      // Validate source epic exists
      const epic = await storage.getEpic(epicId)
      if (!epic) {
        this.error(`Epic not found: ${epicId}`)
      }

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const allEpics = await storage.listEpics()
        const otherEpics = allEpics.filter(e => e.id !== epicId)

        if (otherEpics.length === 0) {
          this.log(styles.muted('\nNo other epics to create dependency with.'))
          await storage.close()
          return
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select epic that ${epicId} depends on:`,
          choices: otherEpics.map(e => ({
            name: `${e.id} - ${e.title} (${e.status})`,
            value: e.id,
          })),
        }])
        dependsOnId = selected
      }

      // Validate target epic exists
      const dependsOnEpic = await storage.getEpic(dependsOnId!)
      if (!dependsOnEpic) {
        this.error(`Epic not found: ${dependsOnId}`)
      }

      // Create the dependency
      const dependencyType = (flags.blocks ? 'blocks' : flags.type) as EpicDependencyType

      await storage.createEpicDependency(epicId, dependsOnId!, dependencyType)

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

      const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                        dependencyType === 'relates_to' ? 'relates to' :
                        'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(epicId)} ${typeLabel} ${styles.emphasis(dependsOnId!)}`))
      this.log(styles.muted(`   ${epic.title}`))
      this.log(styles.muted(`   ${typeLabel} ${dependsOnEpic.title}`))

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
