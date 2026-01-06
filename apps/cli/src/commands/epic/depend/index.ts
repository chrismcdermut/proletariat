import { Args, Command, Flags } from '@oclif/core'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class EpicDepend extends Command {
  static description = 'List dependencies for an epic'

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %> EPIC-001 --all',
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
    all: Flags.boolean({
      char: 'a',
      description: 'Show all dependencies (blockers and blocking)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicDepend)

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const epic = await storage.getEpic(args.id)
      if (!epic) {
        this.error(`Epic not found: ${args.id}`)
      }

      // Get dependencies
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
        // Get all epics and find ones that depend on this epic
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
