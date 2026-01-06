import { Args, Command, Flags } from '@oclif/core'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { EpicDependencyType } from '../../../lib/pmo/types.js'

export default class EpicLink extends Command {
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
      required: true,
    }),
  }

  static flags = {
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
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicLink)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const epic = await storage.getEpic(args.id)
      if (!epic) {
        this.error(`Epic not found: ${args.id}`)
      }

      // If a dependency flag is provided, add the dependency
      if (flags.blocks || flags.relates || flags.duplicates) {
        const targetId = flags.blocks || flags.relates || flags.duplicates
        const dependencyType: EpicDependencyType = flags.blocks ? 'blocks' :
                                                    flags.relates ? 'relates_to' : 'duplicates'

        const targetEpic = await storage.getEpic(targetId!)
        if (!targetEpic) {
          this.error(`Epic not found: ${targetId}`)
        }

        try {
          await storage.createEpicDependency(args.id, targetId!, dependencyType)
          await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

          const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                            dependencyType === 'relates_to' ? 'relates to' : 'duplicates'

          this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} ${typeLabel} ${styles.emphasis(targetId!)}`))
          this.log(styles.muted(`   ${epic.title}`))
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

        await storage.close()
        return
      }

      // Otherwise, list dependencies
      const dependencies = await storage.listEpicDependencies(args.id)
      const isBlocked = await storage.isEpicBlocked(args.id)

      this.log(`\n${styles.emphasis(epic.id)}: ${epic.title}`)

      if (isBlocked) {
        this.log(styles.warning('  Status: BLOCKED'))
      }

      // Show blocking dependencies
      const blockers = dependencies.filter(d => d.dependencyType === 'blocks')
      if (blockers.length > 0) {
        this.log(styles.muted('\n  Blocked by:'))
        for (const dep of blockers) {
          const blockerEpic = await storage.getEpic(dep.dependsOnEpicId)
          if (blockerEpic) {
            const status = blockerEpic.status === 'complete' ? styles.success('complete') : styles.warning(blockerEpic.status)
            this.log(`    - ${blockerEpic.id}: ${blockerEpic.title} (${status})`)
          }
        }
      }

      // Show other dependency types
      const otherDeps = dependencies.filter(d => d.dependencyType !== 'blocks')
      if (otherDeps.length > 0) {
        this.log(styles.muted('\n  Related:'))
        for (const dep of otherDeps) {
          const relatedEpic = await storage.getEpic(dep.dependsOnEpicId)
          if (relatedEpic) {
            this.log(`    - ${dep.dependencyType}: ${relatedEpic.id} - ${relatedEpic.title}`)
          }
        }
      }

      // Optionally show epics blocked BY this epic
      if (flags.all) {
        const allEpics = await storage.listEpics()
        const blocking: Array<{ epic: typeof epic; type: string }> = []

        for (const otherEpic of allEpics) {
          if (otherEpic.id === args.id) continue
          const otherDeps = await storage.listEpicDependencies(otherEpic.id)
          const blockingDep = otherDeps.find(d => d.dependsOnEpicId === args.id)
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
      await storage.close()
    } catch (error) {
      await storage.close()
      throw error
    }
  }
}
