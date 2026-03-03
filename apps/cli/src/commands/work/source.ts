import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  loadActiveWorkSource,
  getRegisteredWorkSources,
  formatWorkSourceRef,
} from '../../lib/work-source/index.js'

export default class WorkSource extends PMOCommand {
  static description = 'Show the active work source used by "work spawn"'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> work source set linear:PRO',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkSource)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    const active = loadActiveWorkSource(db)
    const registered = getRegisteredWorkSources(db)

    const activeResult = active ? {
      provider: active.provider,
      context: active.context ?? null,
      ref: formatWorkSourceRef(active),
    } : null

    const registeredResult = registered.map((source) => ({
      provider: source.provider,
      context: source.context ?? null,
      ref: formatWorkSourceRef(source),
    }))

    if (jsonMode) {
      outputSuccessAsJson({
        activeSource: activeResult,
        registeredSources: registeredResult,
      }, createMetadata('work source', flags))
    }

    this.log(styles.header('Work Source'))
    if (active) {
      this.log(styles.success(`  Active: ${formatWorkSourceRef(active)}`))
      this.log(styles.muted(`  Provider: ${active.provider}`))
      if (active.context) {
        this.log(styles.muted(`  Context: ${active.context}`))
      }
    } else {
      this.log(styles.muted('  Active: not set'))
      this.log(styles.muted('  Default behavior: PMO tickets unless an external source is selected'))
    }

    this.log('')
    this.log(styles.muted(`Registered sources: ${registeredResult.map(source => source.ref).join(', ')}`))
    this.log(styles.muted('Set with: prlt work source set <provider[:context]>'))
  }
}
