import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { EpicDependencyType } from '../../../lib/pmo/types.js'

export default class EpicLinkRemove extends PMOCommand {
  static description = 'Remove a dependency from an epic'
  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 --all',
  ]

  static args = {
    id: Args.string({ description: 'Epic ID', required: true }),
    target: Args.string({ description: 'Target epic ID to unlink', required: false }),
  }
  static flags = {
    ...pmoBaseFlags,
    project: Flags.string({ char: 'P', description: 'Project ID' }),
    type: Flags.string({ char: 't', description: 'Dependency type', options: ['blocks', 'relates_to', 'duplicates'] }),
    all: Flags.boolean({ char: 'a', description: 'Remove all dependencies', default: false }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicLinkRemove)

    const epic = await this.storage.getEpic(args.id)
    if (!epic) this.error(`Epic not found: ${args.id}`)

    const dependencies = await this.storage.listEpicDependencies(args.id)
    if (dependencies.length === 0) { this.log(styles.muted(`\nEpic ${args.id} has no dependencies.`)); return }

    if (flags.all) {
      const { confirmed } = await inquirer.prompt([{ type: 'confirm', name: 'confirmed', message: `Remove all ${dependencies.length} dependencies?`, default: false }])
      if (!confirmed) { this.log(styles.muted('\nCancelled.')); return }
      for (const dep of dependencies) await this.storage.deleteEpicDependency(args.id, dep.dependsOnEpicId, dep.dependencyType)
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
      this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${args.id}`))
      return
    }

    let targetId = args.target
    if (!targetId) {
      const choices = await Promise.all(dependencies.map(async dep => {
        const depEpic = await this.storage.getEpic(dep.dependsOnEpicId)
        return { name: `${dep.dependsOnEpicId} - ${depEpic?.title || 'Unknown'} (${dep.dependencyType})`, value: dep.dependsOnEpicId }
      }))
      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: 'Select dependency to remove:', choices }])
      targetId = selected
    }

    await this.storage.deleteEpicDependency(args.id, targetId!, flags.type as EpicDependencyType | undefined)
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
    this.log(styles.success(`\n✅ Removed dependency: ${args.id} → ${targetId}`))
  }
}
