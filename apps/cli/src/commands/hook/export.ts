/**
 * prlt hook export — Export hook configuration to YAML.
 *
 * Dumps the current hook configuration from the database as YAML,
 * suitable for saving to .proletariat/hooks.yml.
 */

import * as path from 'node:path'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { exportHooksToYaml } from '../../lib/orchestrate/index.js'

export default class HookExport extends PMOCommand {
  static description = 'Export hook configuration as YAML'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(HookExport)
    const jsonMode = shouldOutputJson(flags)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('hook export', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new SqliteDatabase(dbPath)

    try {
      const yamlContent = exportHooksToYaml(db)

      if (jsonMode) {
        outputSuccessAsJson(
          { yaml: yamlContent },
          createMetadata('hook export', flags),
        )
        return
      }

      this.log(styles.title('Hook Configuration (YAML)'))
      this.log('')
      this.log(yamlContent)
      this.log(styles.muted('  Save to .proletariat/hooks.yml to version control'))
    } finally {
      db.close()
    }
  }
}
