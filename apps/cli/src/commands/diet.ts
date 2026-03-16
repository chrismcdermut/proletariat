import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/base-command.js'
import { shouldOutputJson, outputErrorAsJson, createMetadata } from '../lib/prompt-json.js'
import { styles, divider } from '../lib/styles.js'
import {
  loadDietConfig,
  saveDietConfig,
  parseDietString,
  formatDietConfig,
  type DietConfig,
  type DietCategoryReport,
  type DietReport,
} from '../lib/pmo/diet.js'

export default class Diet extends PMOCommand {
  static description = 'Show or configure diet ratios for balanced ticket distribution'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --set "ship=4,grow=2.5,support=1.5,bizops=1,strategy=1"',
    '<%= config.bin %> <%= command.id %> --reset',
  ]

  static flags = {
    ...pmoBaseFlags,
    set: Flags.string({
      char: 's',
      description: 'Set diet weights (e.g., "ship=4,grow=2,support=1") - normalized to percentages automatically',
    }),
    reset: Flags.boolean({
      char: 'r',
      description: 'Reset diet to default ratios',
      default: false,
    }),
  }

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(Diet)
    const jsonMode = shouldOutputJson(flags)
    const projectId = await this.requireProject()
    const db = this.storage.getDatabase()

    // Handle --set
    if (flags.set) {
      try {
        const newConfig = parseDietString(flags.set)
        saveDietConfig(db, newConfig)
        if (jsonMode) {
          this.log(JSON.stringify({ type: 'success', result: { action: 'set', diet: newConfig } }, null, 2))
        } else {
          this.log(styles.success(`Diet updated: ${formatDietConfig(newConfig)}`))
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson('INVALID_DIET', message, createMetadata('diet', flags))
          return
        }
        this.error(message)
      }
      return
    }

    // Handle --reset
    if (flags.reset) {
      const { DEFAULT_DIET_CONFIG } = await import('../lib/pmo/diet.js')
      saveDietConfig(db, DEFAULT_DIET_CONFIG)
      if (jsonMode) {
        this.log(JSON.stringify({ type: 'success', result: { action: 'reset', diet: DEFAULT_DIET_CONFIG } }, null, 2))
      } else {
        this.log(styles.success(`Diet reset to defaults: ${formatDietConfig(DEFAULT_DIET_CONFIG)}`))
      }
      return
    }

    // Show diet report
    const dietConfig = loadDietConfig(db)
    const report = await this.buildDietReport(projectId, dietConfig)

    if (jsonMode) {
      this.log(JSON.stringify({ type: 'success', result: { diet: dietConfig, report } }, null, 2))
      return
    }

    this.displayDietReport(report, dietConfig)
  }

  /**
   * Build a diet report comparing actual Ready distribution to targets.
   */
  private async buildDietReport(projectId: string, dietConfig: DietConfig): Promise<DietReport> {
    // Get all ready/unstarted tickets using statusCategory filter
    const readyTickets = await this.storage.listTickets(projectId, { statusCategory: 'unstarted' })

    const totalReady = readyTickets.length

    // Count by category
    const categoryCounts = new Map<string, number>()
    let uncategorized = 0
    for (const ticket of readyTickets) {
      const cat = (ticket.category || '').toLowerCase()
      if (cat) {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
      } else {
        uncategorized++
      }
    }

    // Build category reports
    const categories: DietCategoryReport[] = dietConfig.ratios.map(ratio => {
      const count = categoryCounts.get(ratio.category) || 0
      const actual = totalReady > 0 ? count / totalReady : 0
      const targetCount = Math.round(totalReady * ratio.target)
      const delta = actual - ratio.target
      const tolerance = 0.05 // 5% tolerance

      let status: 'over' | 'under' | 'ok' = 'ok'
      if (delta > tolerance) status = 'over'
      else if (delta < -tolerance) status = 'under'

      return {
        category: ratio.category,
        target: ratio.target,
        actual,
        count,
        targetCount,
        delta,
        status,
      }
    })

    // Check for categories not in the diet config
    for (const [cat, count] of categoryCounts) {
      if (!dietConfig.ratios.some(r => r.category === cat)) {
        const actual = totalReady > 0 ? count / totalReady : 0
        categories.push({
          category: cat,
          target: 0,
          actual,
          count,
          targetCount: 0,
          delta: actual,
          status: actual > 0.05 ? 'over' : 'ok',
        })
      }
    }

    return { categories, totalReady, uncategorized }
  }

  /**
   * Display the diet report with visual indicators.
   */
  private displayDietReport(report: DietReport, dietConfig: DietConfig): void {
    this.log(styles.title('\nDiet Report'))
    this.log(divider(65))
    this.log(`  Current diet: ${formatDietConfig(dietConfig)}`)
    this.log(`  Total in Ready: ${report.totalReady}`)
    if (report.uncategorized > 0) {
      this.log(styles.warning(`  Uncategorized: ${report.uncategorized}`))
    }
    this.log(divider(65))

    if (report.totalReady === 0) {
      this.log(styles.muted('\n  No tickets in Ready. Run "prlt pull" to populate.\n'))
      return
    }

    // Header
    this.log('')
    this.log(
      `  ${'Category'.padEnd(14)} ${'Target'.padEnd(8)} ${'Actual'.padEnd(8)} ${'Count'.padEnd(7)} ${'Status'.padEnd(8)} ${'Bar'}`
    )
    this.log(`  ${divider(62).trim()}`)

    // Category rows
    for (const cat of report.categories) {
      const targetPct = `${Math.round(cat.target * 100)}%`
      const actualPct = `${Math.round(cat.actual * 100)}%`
      const countStr = `${cat.count}/${cat.targetCount}`

      let statusIndicator: string
      switch (cat.status) {
        case 'over':
          statusIndicator = styles.warning('OVER')
          break
        case 'under':
          statusIndicator = styles.error('UNDER')
          break
        default:
          statusIndicator = styles.success('OK')
      }

      // Visual bar (max 20 chars)
      const barWidth = 20
      const actualBar = Math.round(cat.actual * barWidth)
      const targetBar = Math.round(cat.target * barWidth)
      let bar = ''
      for (let i = 0; i < barWidth; i++) {
        if (i < actualBar && i < targetBar) {
          bar += styles.success('█')
        } else if (i < actualBar) {
          bar += styles.warning('█')
        } else if (i < targetBar) {
          bar += styles.muted('░')
        } else {
          bar += ' '
        }
      }

      this.log(
        `  ${cat.category.padEnd(14)} ${targetPct.padEnd(8)} ${actualPct.padEnd(8)} ${countStr.padEnd(7)} ${statusIndicator.padEnd(8 + 10)} ${bar}`
      )
    }

    // Warnings
    const warnings = report.categories.filter(c => c.status !== 'ok')
    if (warnings.length > 0) {
      this.log('')
      this.log(styles.warning('  Warnings:'))
      for (const w of warnings) {
        const direction = w.status === 'over' ? 'over' : 'under'
        const delta = Math.abs(Math.round(w.delta * 100))
        this.log(styles.warning(`    ${w.category}: ${delta}% ${direction}-represented`))
      }
    }

    this.log('')
  }
}
