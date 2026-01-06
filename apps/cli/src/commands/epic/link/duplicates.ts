import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class EpicLinkDuplicates extends Command {
  static description = 'Mark an epic as duplicate of another'
  static examples = ['<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002']

  static args = {
    id: Args.string({ description: 'Duplicate epic ID', required: true }),
    original: Args.string({ description: 'Original epic ID', required: false }),
  }
  static flags = { project: Flags.string({ char: 'P', description: 'Project ID' }) }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicLinkDuplicates)
    const { storage, pmoPath } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const epic = await storage.getEpic(args.id)
      if (!epic) this.error(`Epic not found: ${args.id}`)

      let originalId = args.original
      if (!originalId) {
        const allEpics = await storage.listEpics()
        const otherEpics = allEpics.filter(e => e.id !== args.id)
        if (otherEpics.length === 0) { this.log(styles.muted('\nNo other epics.')); await storage.close(); return }
        const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select the original epic (${args.id} is a duplicate of):`,
          choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })) }])
        originalId = selected
      }

      const originalEpic = await storage.getEpic(originalId!)
      if (!originalEpic) this.error(`Epic not found: ${originalId}`)

      await storage.createEpicDependency(args.id, originalId!, 'duplicates')
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
      await storage.close()
    } catch (error) { await storage.close(); throw error }
  }
}
