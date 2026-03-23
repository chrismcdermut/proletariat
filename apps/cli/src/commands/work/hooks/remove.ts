import { Args } from '@oclif/core'
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

export default class WorkHooksRemove extends PMOCommand {
  static description = 'Remove a work lifecycle hook'

  static examples = [
    '<%= config.bin %> <%= command.id %> notify-start',
    '<%= config.bin %> <%= command.id %> deploy-hook',
  ]

  static args = {
    name: Args.string({
      description: 'Hook name to remove - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkHooksRemove)
    const jsonMode = shouldOutputJson(flags)

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('work hooks remove', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new SqliteDatabase(dbPath)

    try {
      const hookStorage = new WorkHookStorage(db)

      let hookName = args.name

      if (!hookName) {
        const hooks = hookStorage.list()

        if (hooks.length === 0) {
          if (jsonMode) {
            outputErrorAsJson('NO_HOOKS', 'No hooks configured.', createMetadata('work hooks remove', flags))
            return
          }
          this.log(styles.info('No hooks configured.'))
          return
        }

        const selected = await this.selectFromList({
          message: 'Select hook to remove:',
          items: hooks,
          getName: (h) => `${h.name} (${h.event} → ${h.actionType})`,
          getValue: (h) => h.name,
          getCommand: (h) => `prlt work hooks remove ${h.name} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work hooks remove' } : null,
          allowCancel: true,
        })

        if (!selected) {
          return
        }
        hookName = selected
      }

      // Find the hook
      const hook = hookStorage.getByName(hookName)
      if (!hook) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Hook "${hookName}" not found.`, createMetadata('work hooks remove', flags))
          return
        }
        this.error(`Hook "${hookName}" not found.`)
      }

      // Delete it
      hookStorage.delete(hook.id)

      if (jsonMode) {
        outputSuccessAsJson(
          {
            removed: {
              id: hook.id,
              name: hook.name,
              event: hook.event,
            },
            message: `Hook "${hook.name}" removed.`,
          },
          createMetadata('work hooks remove', flags),
        )
        return
      }

      this.log(styles.success(`Hook "${hook.name}" removed.`))
      this.log(styles.muted(`  Event:  ${hook.event}`))
      this.log(styles.muted(`  Action: ${hook.actionType} → ${hook.actionValue}`))
    } finally {
      db.close()
    }
  }
}
