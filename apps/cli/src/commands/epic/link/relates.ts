import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class EpicLinkRelates extends PMOCommand {
  static description = 'Add a relates_to dependency (informational link)'
  static examples = ['<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002']

  static args = {
    id: Args.string({ description: 'Epic ID', required: true }),
    target: Args.string({ description: 'Related epic ID', required: false }),
  }
  static flags = {
    ...pmoBaseFlags,
    project: Flags.string({ char: 'P', description: 'Project ID' }),
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(EpicLinkRelates)

    const epic = await this.storage.getEpic(args.id)
    if (!epic) this.error(`Epic not found: ${args.id}`)

    let targetId = args.target
    if (!targetId) {
      const allEpics = await this.storage.listEpics()
      const otherEpics = allEpics.filter(e => e.id !== args.id)
      if (otherEpics.length === 0) { this.log(styles.muted('\nNo other epics.')); return }
      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select epic that ${args.id} relates to:`,
        choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })) }])
      targetId = selected
    }

    const targetEpic = await this.storage.getEpic(targetId!)
    if (!targetEpic) this.error(`Epic not found: ${targetId}`)

    await this.storage.createEpicDependency(args.id, targetId!, 'relates_to')
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
    this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} relates to ${styles.emphasis(targetId!)}`))
  }
}
