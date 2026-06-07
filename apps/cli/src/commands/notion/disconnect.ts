import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { clearNotionConfig } from '../../lib/notion/index.js'
import { removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'

export default class NotionDisconnect extends PMOCommand {
  static description = 'Disconnect from Notion: remove stored credentials and database default'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(NotionDisconnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    clearNotionConfig(db)
    removeProviderSourcesByProvider(db, 'notion')

    if (jsonMode) {
      outputSuccessAsJson({
        disconnected: true,
        message: 'Notion credentials and configuration removed.',
      }, createMetadata('notion disconnect', flags))
      return
    }

    this.log(colors.success('Notion credentials and configuration removed.'))
  }
}
