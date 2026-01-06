import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class EpicLinkBlock extends Command {
  static description = 'Add a blocking dependency (epic is blocked by another)'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002  # EPIC-001 is blocked by EPIC-002',
  ]

  static args = {
    id: Args.string({ description: 'Epic ID that will be blocked', required: true }),
    blocker: Args.string({ description: 'Epic ID that blocks this epic', required: false }),
  }

  static flags = {
    project: Flags.string({ char: 'P', description: 'Project ID' }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicLinkBlock)
    const { storage, pmoPath } = await getPMOContext(flags.project, (msg) => this.log(styles.muted(msg)), true)

    try {
      const epic = await storage.getEpic(args.id)
      if (!epic) this.error(`Epic not found: ${args.id}`)

      let blockerId = args.blocker
      if (!blockerId) {
        const allEpics = await storage.listEpics()
        const otherEpics = allEpics.filter(e => e.id !== args.id)
        if (otherEpics.length === 0) { this.log(styles.muted('\nNo other epics.')); await storage.close(); return }

        const { selected } = await inquirer.prompt([{
          type: 'list', name: 'selected', message: `Select epic that blocks ${args.id}:`,
          choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title} (${e.status})`, value: e.id })),
        }])
        blockerId = selected
      }

      const blockerEpic = await storage.getEpic(blockerId!)
      if (!blockerEpic) this.error(`Epic not found: ${blockerId}`)

      await storage.createEpicDependency(args.id, blockerId!, 'blocks')
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} is blocked by ${styles.emphasis(blockerId!)}`))
      this.log(styles.muted(`   ${epic.title} blocked by: ${blockerEpic.title}`))
      await storage.close()
    } catch (error) {
      await storage.close()
      if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('self-dependency'))) {
        this.error(error.message.includes('already exists') ? 'Dependency already exists' : 'Cannot create self-dependency')
      }
      throw error
    }
  }
}
