/**
 * prlt hook preset <name> — Apply a hook preset.
 *
 * Presets:
 * - aggressive: auto everything
 * - conservative: confirm everything
 * - supervised: auto for safe ops, confirm for destructive
 */

import { Args } from '@oclif/core'
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
import { applyPreset, PRESET_NAMES, PRESETS } from '../../lib/orchestrate/index.js'
import type { PresetName } from '../../lib/orchestrate/index.js'

export default class HookPreset extends PMOCommand {
  static description = 'Apply a hook preset (aggressive, conservative, supervised)'

  static examples = [
    '<%= config.bin %> <%= command.id %> aggressive',
    '<%= config.bin %> <%= command.id %> conservative',
    '<%= config.bin %> <%= command.id %> supervised',
  ]

  static args = {
    preset: Args.string({
      description: 'Preset name to apply',
      required: true,
      options: PRESET_NAMES,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(HookPreset)
    const jsonMode = shouldOutputJson(flags)
    const presetName = args.preset as PresetName

    if (!PRESET_NAMES.includes(presetName)) {
      if (jsonMode) {
        outputErrorAsJson('INVALID_PRESET', `Unknown preset: ${presetName}. Valid: ${PRESET_NAMES.join(', ')}`, createMetadata('hook preset', flags))
        return
      }
      this.error(`Unknown preset: ${presetName}. Valid: ${PRESET_NAMES.join(', ')}`)
    }

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('hook preset', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new SqliteDatabase(dbPath)

    try {
      const count = applyPreset(db, presetName)
      const preset = PRESETS[presetName]

      if (jsonMode) {
        outputSuccessAsJson(
          {
            preset: presetName,
            description: preset.description,
            hooksApplied: count,
          },
          createMetadata('hook preset', flags),
        )
        return
      }

      this.log(styles.success(`Applied preset: ${presetName}`))
      this.log(styles.muted(`  ${preset.description}`))
      this.log(styles.muted(`  ${count} hooks configured`))
    } finally {
      db.close()
    }
  }
}
