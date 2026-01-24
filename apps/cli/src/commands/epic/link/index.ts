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

export default class EpicLink extends PMOCommand {
  static description = 'Manage epic dependencies (links)'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001                     # List dependencies',
    '<%= config.bin %> <%= command.id %> EPIC-001 --blocks EPIC-002   # EPIC-001 is blocked by EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 --relates EPIC-002  # EPIC-001 relates to EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 --duplicates EPIC-002',
    '<%= config.bin %> <%= command.id %> EPIC-001 --all               # Show all links',
  ]

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    blocks: Flags.string({
      char: 'b',
      description: 'Add blocking dependency: this epic is blocked by TARGET',
    }),
    relates: Flags.string({
      char: 'r',
      description: 'Add relates_to dependency',
    }),
    duplicates: Flags.string({
      char: 'd',
      description: 'Add duplicates dependency',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show all dependencies (blockers and blocking)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicLink)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic link', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const projectId = await this.requireProject()

    let epicId = args.id
    if (!epicId) {
      const epics = await this.storage.listEpics(projectId)
      if (epics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic link', flags))
          return
        }
        this.log(styles.muted('\nNo epics found.'))
        return
      }

      // In JSON mode, output epic selection prompt
      if (jsonMode) {
        const epicChoices = epics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id }))
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select epic to manage dependencies:', epicChoices),
          createMetadata('epic link', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to manage dependencies:',
        choices: epics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })),
      }])
      epicId = selected
    }

    const epic = await this.storage.getEpic(epicId!)
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`)
    }

    // If a dependency flag is provided, add the dependency directly
    if (flags.blocks || flags.relates || flags.duplicates) {
      const targetId = flags.blocks || flags.relates || flags.duplicates
      const dependencyType: EpicDependencyType = flags.blocks ? 'blocks' :
                                                  flags.relates ? 'relates_to' : 'duplicates'
      await this.addDependency(epicId!, targetId!, dependencyType, epic.title)
      return
    }

    // Interactive mode: show menu in a loop
    let continueLoop = true
    while (continueLoop) {
      const allEpics = await this.storage.listEpics(projectId)
      const otherEpics = allEpics.filter(e => e.id !== epicId)

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: `Dependencies for ${epic.id}:`,
        choices: [
          { name: 'View dependencies', value: 'view' },
          { name: 'Add blocking dependency (blocked by...)', value: 'blocks' },
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
        await this.viewDependencies(epicId!, epic, flags.all)
        continue
      }

      if (action === 'remove') {
        const dependencies = await this.storage.listEpicDependencies(epicId!)
        if (dependencies.length === 0) {
          this.log(styles.muted('\nNo dependencies to remove.'))
          continue
        }
        const choices = await Promise.all(dependencies.map(async dep => {
          const depEpic = await this.storage.getEpic(dep.dependsOnEpicId)
          return {
            name: `${dep.dependsOnEpicId} - ${depEpic?.title || 'Unknown'} (${dep.dependencyType})`,
            value: { targetId: dep.dependsOnEpicId, type: dep.dependencyType }
          }
        }))
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select dependency to remove:',
          choices,
        }])
        await this.storage.deleteEpicDependency(epicId!, selected.targetId, selected.type)
        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
        this.log(styles.success(`\n✅ Removed dependency: ${epicId} → ${selected.targetId}`))
        continue
      }

      // Add dependency
      if (otherEpics.length === 0) {
        this.log(styles.muted('\nNo other epics to link to.'))
        continue
      }
      const { targetId } = await inquirer.prompt([{
        type: 'list',
        name: 'targetId',
        message: `Select epic that ${epicId} ${action === 'blocks' ? 'is blocked by' : action === 'relates_to' ? 'relates to' : 'duplicates'}:`,
        choices: otherEpics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })),
      }])
      await this.addDependency(epicId!, targetId, action as EpicDependencyType, epic.title)
    }
  }

  private async addDependency(
    epicId: string,
    targetId: string,
    dependencyType: EpicDependencyType,
    epicTitle: string
  ): Promise<void> {
    const targetEpic = await this.storage.getEpic(targetId)
    if (!targetEpic) {
      this.error(`Epic not found: ${targetId}`)
    }

    try {
      await this.storage.createEpicDependency(epicId, targetId, dependencyType)
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                        dependencyType === 'relates_to' ? 'relates to' : 'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(epicId)} ${typeLabel} ${styles.emphasis(targetId)}`))
      this.log(styles.muted(`   ${epicTitle}`))
      this.log(styles.muted(`   ${typeLabel} ${targetEpic.title}`))
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
    epicId: string,
    epic: { id: string; title: string; projectId: string },
    showAll: boolean
  ): Promise<void> {
    const dependencies = await this.storage.listEpicDependencies(epicId)
    const isBlocked = await this.storage.isEpicBlocked(epicId)

    this.log(`\n${styles.emphasis(epic.id)}: ${epic.title}`)

    if (isBlocked) {
      this.log(styles.warning('  Status: BLOCKED'))
    }

    const blockers = dependencies.filter(d => d.dependencyType === 'blocks')
    if (blockers.length > 0) {
      this.log(styles.muted('\n  Blocked by:'))
      for (const dep of blockers) {
        const blockerEpic = await this.storage.getEpic(dep.dependsOnEpicId)
        if (blockerEpic) {
          const status = blockerEpic.status === 'complete' ? styles.success('complete') : styles.warning(blockerEpic.status)
          this.log(`    - ${blockerEpic.id}: ${blockerEpic.title} (${status})`)
        }
      }
    }

    const otherDeps = dependencies.filter(d => d.dependencyType !== 'blocks')
    if (otherDeps.length > 0) {
      this.log(styles.muted('\n  Related:'))
      for (const dep of otherDeps) {
        const relatedEpic = await this.storage.getEpic(dep.dependsOnEpicId)
        if (relatedEpic) {
          this.log(`    - ${dep.dependencyType}: ${relatedEpic.id} - ${relatedEpic.title}`)
        }
      }
    }

    if (showAll) {
      const allEpics = await this.storage.listEpics(epic.projectId)
      const blocking: Array<{ epic: typeof epic; type: string }> = []

      for (const otherEpic of allEpics) {
        if (otherEpic.id === epicId) continue
        const otherDeps = await this.storage.listEpicDependencies(otherEpic.id)
        const blockingDep = otherDeps.find(d => d.dependsOnEpicId === epicId)
        if (blockingDep) {
          blocking.push({ epic: otherEpic, type: blockingDep.dependencyType })
        }
      }

      if (blocking.length > 0) {
        this.log(styles.muted('\n  Blocking:'))
        for (const { epic: blockedEpic, type } of blocking) {
          this.log(`    - ${blockedEpic.id}: ${blockedEpic.title} (${type})`)
        }
      }
    }

    if (dependencies.length === 0) {
      this.log(styles.muted('\n  No dependencies.'))
    }

    this.log('')
  }
}
