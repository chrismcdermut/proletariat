import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  loadDefaultWorkSource,
  getRegisteredWorkSources,
  formatWorkSourceRef,
} from '../../lib/work-source/index.js'

export default class WorkSource extends PMOCommand {
  static description = 'Show the default work source used by "work start" and "work spawn"'

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

    const defaultSrc = loadDefaultWorkSource(db)
    const registered = getRegisteredWorkSources(db)

    const defaultResult = defaultSrc ? {
      provider: defaultSrc.provider,
      context: defaultSrc.context ?? null,
      ref: formatWorkSourceRef(defaultSrc),
    } : null

    const registeredResult = registered.map((source) => ({
      provider: source.provider,
      context: source.context ?? null,
      ref: formatWorkSourceRef(source),
    }))

    if (jsonMode) {
      outputSuccessAsJson({
        activeSource: defaultResult,
        registeredSources: registeredResult,
      }, createMetadata('work source', flags))
    }

    this.log(styles.header('Work Source'))
    if (defaultSrc) {
      this.log(styles.success(`  Default: ${formatWorkSourceRef(defaultSrc)}`))
      this.log(styles.muted(`  Provider: ${defaultSrc.provider}`))
      if (defaultSrc.context) {
        this.log(styles.muted(`  Context: ${defaultSrc.context}`))
      }
    } else {
      this.log(styles.muted('  Default: not set'))
      this.log(styles.muted('  Non-TKT ticket IDs will require --from provider:KEY'))
    }

    this.log('')
    this.log(styles.muted(`Registered sources: ${registeredResult.map(source => source.ref).join(', ')}`))
    this.log(styles.muted('Set with: prlt work source set <provider[:context]>'))
  }
}
