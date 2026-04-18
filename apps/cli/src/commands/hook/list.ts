/**
 * prlt hook list — List all configured orchestrate hooks.
 *
 * Shows hooks with their mode, priority, and source.
 */

import { Flags } from '@oclif/core'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

interface HookRow {
  id: string
  name: string
  event: string
  action_type: string
  action_value: string
  action_ref: string | null
  enabled: number
  description: string | null
  mode: string | null
  priority: number | null
  source: string | null
  config: string | null
  created_at: string
}

export default class HookList extends PromptCommand {
  static description = 'List configured orchestrate hooks'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --event on_ci_green',
    '<%= config.bin %> <%= command.id %> --mode auto',
  ]

  static flags = {
    ...machineOutputFlags,
    event: Flags.string({
      description: 'Filter by event name',
    }),
    mode: Flags.string({
      description: 'Filter by mode (auto, confirm, notify, off)',
      options: ['auto', 'confirm', 'notify', 'off'],
    }),
    source: Flags.string({
      description: 'Filter by source (yaml, cli, preset)',
      options: ['yaml', 'cli', 'preset'],
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(HookList)
    const jsonMode = shouldOutputJson(flags)
    const parsedFlags = flags as Record<string, unknown>

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('hook list', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)

    try {
      let sql = 'SELECT * FROM pmo_work_hooks WHERE 1=1'
      const params: unknown[] = []

      if (parsedFlags.event) {
        sql += ' AND event = ?'
        params.push(parsedFlags.event)
      }

      if (parsedFlags.mode) {
        sql += ' AND mode = ?'
        params.push(parsedFlags.mode)
      }

      if (parsedFlags.source) {
        sql += ' AND source = ?'
        params.push(parsedFlags.source)
      }

      sql += ' ORDER BY event ASC, priority ASC, created_at ASC'

      let hooks: HookRow[]
      try {
        hooks = db.prepare(sql).all(...params) as HookRow[]
      } catch {
        // Fallback without new columns
        hooks = db.prepare('SELECT * FROM pmo_work_hooks ORDER BY created_at ASC').all() as HookRow[]
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            hooks: hooks.map(h => ({
              id: h.id,
              name: h.name,
              event: h.event,
              actionType: h.action_type,
              actionValue: h.action_value,
              actionRef: h.action_ref || null,
              enabled: h.enabled === 1,
              mode: h.mode || 'auto',
              priority: h.priority ?? 0,
              source: h.source || 'cli',
              description: h.description,
              config: h.config ? JSON.parse(h.config) : null,
            })),
            count: hooks.length,
          },
          createMetadata('hook list', flags),
        )
        return
      }

      if (hooks.length === 0) {
        this.log(styles.info('No hooks configured.'))
        this.log(styles.muted('  Add one with: prlt work hooks add'))
        this.log(styles.muted('  Or apply a preset: prlt hook preset supervised'))
        return
      }

      this.log(styles.title('Orchestrate Hooks'))
      this.log('')

      // Group by event
      const grouped: Record<string, HookRow[]> = {}
      for (const hook of hooks) {
        if (!grouped[hook.event]) grouped[hook.event] = []
        grouped[hook.event].push(hook)
      }

      for (const [event, eventHooks] of Object.entries(grouped)) {
        this.log(`  ${styles.emphasis(event)}`)
        for (const hook of eventHooks) {
          const enabled = hook.enabled === 1
          const mode = hook.mode || 'auto'
          const source = hook.source || 'cli'
          const status = !enabled
            ? styles.muted('off')
            : mode === 'auto'
              ? styles.success('auto')
              : mode === 'confirm' || mode === 'human'
                ? styles.warning(mode)
                : mode === 'notify'
                  ? styles.info('notify')
                  : mode === 'llm'
                    ? styles.info('llm')
                    : styles.muted('off')

          const typeLabel = hook.action_type !== 'action' && hook.action_type !== 'shell'
            ? ` ${styles.muted(`(${hook.action_type})`)}`
            : ''
          const refLabel = hook.action_ref ? ` ${styles.muted(`ref:${hook.action_ref}`)}` : ''
          this.log(`    ${status} ${styles.code(hook.action_value)}${typeLabel}${refLabel} ${styles.muted(`[${source}]`)}`)
          if (hook.description) {
            this.log(`         ${styles.muted(hook.description)}`)
          }
        }
        this.log('')
      }

      this.log(styles.muted(`  ${hooks.length} hook${hooks.length === 1 ? '' : 's'} configured`))
    } finally {
      db.close()
    }
  }
}
