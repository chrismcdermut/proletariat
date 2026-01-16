import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { EpicDependencyType } from '../../../lib/pmo/types.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicLinkRemove)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic link remove', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const epic = await this.storage.getEpic(args.id)
    if (!epic) return handleError('EPIC_NOT_FOUND', `Epic not found: ${args.id}`)

    const dependencies = await this.storage.listEpicDependencies(args.id)
    if (dependencies.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_DEPENDENCIES', `Epic ${args.id} has no dependencies.`, createMetadata('epic link remove', flags))
        return
      }
      this.log(styles.muted(`\nEpic ${args.id} has no dependencies.`))
      return
    }

    if (flags.all) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ]
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Remove all ${dependencies.length} dependencies?`, confirmChoices),
          createMetadata('epic link remove', flags)
        )
        return
      }

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

      // In JSON mode, output dependency selection prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'target', 'Select dependency to remove:', choices),
          createMetadata('epic link remove', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: 'Select dependency to remove:', choices }])
      targetId = selected
    }

    await this.storage.deleteEpicDependency(args.id, targetId!, flags.type as EpicDependencyType | undefined)
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
    this.log(styles.success(`\n✅ Removed dependency: ${args.id} → ${targetId}`))
  }
}
