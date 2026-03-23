import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
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

export default class WorkHooksToggle extends PMOCommand {
  static description = 'Enable or disable a work lifecycle hook'

  static examples = [
    '<%= config.bin %> <%= command.id %> notify-start --enable',
    '<%= config.bin %> <%= command.id %> deploy-hook --disable',
  ]

  static args = {
    name: Args.string({
      description: 'Hook name to toggle',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    enable: Flags.boolean({
      description: 'Enable the hook',
      exclusive: ['disable'],
    }),
    disable: Flags.boolean({
      description: 'Disable the hook',
      exclusive: ['enable'],
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkHooksToggle)
    const jsonMode = shouldOutputJson(flags)
    const parsedFlags = flags as { enable?: boolean; disable?: boolean }

    if (!parsedFlags.enable && !parsedFlags.disable) {
      if (jsonMode) {
        outputErrorAsJson('MISSING_FLAG', 'Specify --enable or --disable.', createMetadata('work hooks toggle', flags))
        return
      }
      this.error('Specify --enable or --disable.')
    }

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('work hooks toggle', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      const hookStorage = new WorkHookStorage(db)

      const hook = hookStorage.getByName(args.name)
      if (!hook) {
        if (jsonMode) {
          outputErrorAsJson('NOT_FOUND', `Hook "${args.name}" not found.`, createMetadata('work hooks toggle', flags))
          return
        }
        this.error(`Hook "${args.name}" not found.`)
      }

      const enabled = !!parsedFlags.enable
      hookStorage.setEnabled(hook.id, enabled)

      if (jsonMode) {
        outputSuccessAsJson(
          {
            hook: { id: hook.id, name: hook.name, enabled },
            message: `Hook "${hook.name}" ${enabled ? 'enabled' : 'disabled'}.`,
          },
          createMetadata('work hooks toggle', flags),
        )
        return
      }

      const statusText = enabled ? styles.success('enabled') : styles.muted('disabled')
      this.log(`Hook "${hook.name}" ${statusText}.`)
    } finally {
      db.close()
    }
  }
}
