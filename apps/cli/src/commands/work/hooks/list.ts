import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { SqliteDatabase } from '../../../lib/database/sqlite.js'
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { getWorkspaceInfo } from '../../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'
import { WorkHookStorage } from '../../../lib/work-lifecycle/hooks/index.js'
import type { HookableEvent } from '../../../lib/work-lifecycle/hooks/index.js'
import { HOOKABLE_EVENTS } from '../../../lib/work-lifecycle/hooks/index.js'

export default class WorkHooksList extends PMOCommand {
  static description = 'List configured work lifecycle hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --event work:started',
  ]

  static flags = {
    ...pmoBaseFlags,
    event: Flags.string({
      description: 'Filter by event name',
      options: HOOKABLE_EVENTS,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkHooksList)
    const jsonMode = shouldOutputJson(flags)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('work hooks list', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = SqliteDatabase.open(dbPath)

    try {
      const hookStorage = new WorkHookStorage(db)
      const eventFilter = (flags as { event?: string }).event as HookableEvent | undefined
      const hooks = hookStorage.list({ event: eventFilter })

      if (jsonMode) {
        outputSuccessAsJson(
          {
            hooks: hooks.map(h => ({
              id: h.id,
              name: h.name,
              event: h.event,
              actionType: h.actionType,
              actionValue: h.actionValue,
              enabled: h.enabled,
              description: h.description,
              createdAt: h.createdAt,
            })),
            count: hooks.length,
          },
          createMetadata('work hooks list', flags),
        )
        return
      }

      if (hooks.length === 0) {
        this.log(styles.info('No hooks configured.'))
        this.log(styles.muted('  Add one with: prlt work hooks add'))
        return
      }

      this.log(styles.title('Work Lifecycle Hooks'))
      this.log('')

      for (const hook of hooks) {
        const status = hook.enabled ? styles.success('enabled') : styles.muted('disabled')
        this.log(`  ${styles.code(hook.name)} ${styles.muted('—')} ${status}`)
        this.log(`    Event:  ${styles.emphasis(hook.event)}`)
        this.log(`    Action: ${hook.actionType} ${styles.muted('→')} ${hook.actionValue}`)
        if (hook.description) {
          this.log(`    Desc:   ${styles.muted(hook.description)}`)
        }
        this.log('')
      }

      this.log(styles.muted(`  ${hooks.length} hook${hooks.length === 1 ? '' : 's'} configured`))
    } finally {
      db.close()
    }
  }
}
