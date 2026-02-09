import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { PromptCommand } from '../../lib/prompt-command.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  loadExecutionConfig,
  saveTerminalApp,
  saveTerminalOpenInBackground,
  saveTmuxControlMode,
  saveShell,
} from '../../lib/execution/config.js'
import { TerminalApp, Shell } from '../../lib/execution/types.js'
import {
  shouldOutputJson,
  isNonTTY,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  type JsonFlags,
} from '../../lib/prompt-json.js'

export default class Config extends PromptCommand {
  static description = 'View and update workspace configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Interactive menu',
    '<%= config.bin %> <%= command.id %> --json             # Output current config as JSON',
    '<%= config.bin %> <%= command.id %> --set terminal.app iTerm',
    '<%= config.bin %> <%= command.id %> --set terminal.openInBackground true',
    '<%= config.bin %> <%= command.id %> --setting terminal.app --json  # Show terminal app choices',
  ]

  static flags = {
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    set: Flags.string({
      char: 's',
      description: 'Set a config value (format: key value)',
      multiple: true,
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List all configuration values',
      default: false,
    }),
    setting: Flags.string({
      description: 'Navigate to a specific setting prompt (for agent navigation)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Config)
    const jsonMode = shouldOutputJson(flags)
    const jsonModeConfig = jsonMode ? { flags, commandName: 'config' } : null

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.', createMetadata('config', flags))
        this.exit(1)
      }
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      // Load current config
      const config = loadExecutionConfig(db)

      // Handle --set flag
      if (flags.set && flags.set.length > 0) {
        for (const setValue of flags.set) {
          const [key, ...valueParts] = setValue.split(' ')
          const value = valueParts.join(' ')

          if (!key || !value) {
            if (jsonMode) {
              outputErrorAsJson('INVALID_SET_FORMAT', `Invalid format: "${setValue}". Use: --set "key value"`, createMetadata('config', flags))
            } else {
              this.error(`Invalid format: "${setValue}". Use: --set "key value"`)
            }
            continue
          }

          this.setConfigValue(db, key, value, jsonMode)
        }
        db.close()
        return
      }

      // Handle --list or --json flag without --setting (just show config)
      // Also handle non-TTY mode without explicit flags - output config as readable list
      const isExplicitJsonMode = flags.json === true
      const shouldShowConfigList = flags.list || (isExplicitJsonMode && !flags.setting) || (isNonTTY() && !flags.setting && !flags.set?.length)

      if (shouldShowConfigList) {
        if (isExplicitJsonMode) {
          outputSuccessAsJson({
            terminal: {
              app: config.terminal.app,
              openInBackground: config.terminal.openInBackground,
            },
            shell: config.shell,
            tmux: {
              controlMode: config.tmux.controlMode,
            },
            defaultExecutor: config.defaultExecutor,
            defaultEnvironment: config.defaultEnvironment,
            outputMode: config.outputMode,
            sandboxed: config.sandboxed,
          }, createMetadata('config', flags))
        } else {
          this.log('')
          this.log(styles.header('Workspace Configuration'))
          this.log('═'.repeat(50))
          this.log('')
          this.log(styles.emphasis('Terminal'))
          this.log(`  app:              ${config.terminal.app}`)
          this.log(`  openInBackground: ${config.terminal.openInBackground}`)
          this.log('')
          this.log(styles.emphasis('Shell'))
          this.log(`  shell:            ${config.shell}`)
          this.log('')
          this.log(styles.emphasis('Tmux'))
          this.log(`  controlMode:      ${config.tmux.controlMode}`)
          this.log('')
          this.log(styles.emphasis('Execution'))
          this.log(`  defaultExecutor:  ${config.defaultExecutor}`)
          this.log(`  defaultEnvironment: ${config.defaultEnvironment}`)
          this.log(`  outputMode:       ${config.outputMode}`)
          this.log(`  sandboxed:        ${config.sandboxed}`)
          this.log('')
        }
        db.close()
        return
      }

      // Handle --setting flag (navigate directly to a sub-prompt)
      if (flags.setting) {
        await this.handleSettingPrompt(db, config, flags.setting, jsonModeConfig)
        db.close()
        return
      }

      // Interactive menu
      const settingChoices = [
        { name: `Terminal App: ${config.terminal.app}`, value: 'terminal.app', command: 'prlt config --setting terminal.app --json' },
        { name: `Open Tabs in Background: ${config.terminal.openInBackground}`, value: 'terminal.openInBackground', command: 'prlt config --setting terminal.openInBackground --json' },
        { name: `Shell: ${config.shell}`, value: 'shell', command: 'prlt config --setting shell --json' },
        { name: `Tmux Control Mode (iTerm -CC): ${config.tmux.controlMode}`, value: 'tmux.controlMode', command: 'prlt config --setting tmux.controlMode --json' },
      ]

      const { setting } = await this.prompt<{ setting: string }>([
        {
          type: 'list',
          name: 'setting',
          message: 'Select setting to configure:',
          choices: [
            new inquirer.Separator('── Terminal ──'),
            ...settingChoices.slice(0, 2),
            new inquirer.Separator('── Shell ──'),
            settingChoices[2],
            new inquirer.Separator('── Tmux ──'),
            settingChoices[3],
            new inquirer.Separator(),
            { name: 'Exit', value: '__exit__' },
          ],
        },
      ], jsonModeConfig)

      if (setting === '__exit__') {
        db.close()
        return
      }

      // Handle the selected setting
      await this.handleSettingPrompt(db, config, setting, jsonModeConfig)

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Handle a specific setting's sub-prompt
   */
  private async handleSettingPrompt(
    db: Database.Database,
    config: ReturnType<typeof loadExecutionConfig>,
    setting: string,
    jsonModeConfig: { flags: JsonFlags & Record<string, unknown>; commandName: string } | null,
  ): Promise<void> {
    switch (setting) {
      case 'terminal.app': {
        const appChoices = [
          { name: 'iTerm', value: 'iTerm', command: 'prlt config --set "terminal.app iTerm" --json' },
          { name: 'Terminal.app (macOS default)', value: 'Terminal', command: 'prlt config --set "terminal.app Terminal" --json' },
          { name: 'Ghostty', value: 'Ghostty', command: 'prlt config --set "terminal.app Ghostty" --json' },
          { name: 'Alacritty', value: 'Alacritty', command: 'prlt config --set "terminal.app Alacritty" --json' },
          { name: 'Kitty', value: 'Kitty', command: 'prlt config --set "terminal.app Kitty" --json' },
          { name: 'WezTerm', value: 'WezTerm', command: 'prlt config --set "terminal.app WezTerm" --json' },
          { name: 'Warp', value: 'Warp', command: 'prlt config --set "terminal.app Warp" --json' },
          { name: 'tmux', value: 'tmux', command: 'prlt config --set "terminal.app tmux" --json' },
        ]
        const { newApp } = await this.prompt<{ newApp: string }>([
          {
            type: 'list',
            name: 'newApp',
            message: 'Select terminal app:',
            choices: appChoices,
            default: config.terminal.app,
          },
        ], jsonModeConfig)
        saveTerminalApp(db, newApp as TerminalApp)
        this.log(styles.success(`Terminal app set to: ${newApp}`))
        break
      }

      case 'terminal.openInBackground': {
        const bgChoices = [
          { name: 'Yes - Open tabs in background (don\'t steal focus)', value: 'true', command: 'prlt config --set "terminal.openInBackground true" --json' },
          { name: 'No - Bring terminal to foreground when opening tabs', value: 'false', command: 'prlt config --set "terminal.openInBackground false" --json' },
        ]
        const { openInBg } = await this.prompt<{ openInBg: string }>([
          {
            type: 'list',
            name: 'openInBg',
            message: 'Open terminal tabs in background?',
            choices: bgChoices,
            default: String(config.terminal.openInBackground),
          },
        ], jsonModeConfig)
        saveTerminalOpenInBackground(db, openInBg === 'true')
        this.log(styles.success(`Open in background set to: ${openInBg}`))
        break
      }

      case 'shell': {
        const shellChoices = [
          { name: 'zsh (macOS default)', value: 'zsh', command: 'prlt config --set "shell zsh" --json' },
          { name: 'bash', value: 'bash', command: 'prlt config --set "shell bash" --json' },
          { name: 'fish', value: 'fish', command: 'prlt config --set "shell fish" --json' },
        ]
        const { newShell } = await this.prompt<{ newShell: string }>([
          {
            type: 'list',
            name: 'newShell',
            message: 'Select shell:',
            choices: shellChoices,
            default: config.shell,
          },
        ], jsonModeConfig)
        saveShell(db, newShell as Shell)
        this.log(styles.success(`Shell set to: ${newShell}`))
        break
      }

      case 'tmux.controlMode': {
        const ccChoices = [
          { name: 'Yes - Use tmux -CC for native iTerm integration', value: 'true', command: 'prlt config --set "tmux.controlMode true" --json' },
          { name: 'No - Standard tmux interface', value: 'false', command: 'prlt config --set "tmux.controlMode false" --json' },
        ]
        const { controlMode } = await this.prompt<{ controlMode: string }>([
          {
            type: 'list',
            name: 'controlMode',
            message: 'Enable tmux control mode (-CC)?',
            choices: ccChoices,
            default: String(config.tmux.controlMode),
          },
        ], jsonModeConfig)
        saveTmuxControlMode(db, controlMode === 'true')
        this.log(styles.success(`Tmux control mode set to: ${controlMode}`))
        break
      }

      default: {
        const jsonMode = shouldOutputJson(jsonModeConfig?.flags ?? {})
        if (jsonMode) {
          outputErrorAsJson('UNKNOWN_SETTING', `Unknown setting: ${setting}`, createMetadata('config', jsonModeConfig?.flags ?? {}))
        }
        this.error(`Unknown setting: ${setting}`)
      }
    }
  }

  private setConfigValue(db: Database.Database, key: string, value: string, jsonMode: boolean): void {
    const normalizedKey = key.toLowerCase()

    switch (normalizedKey) {
      case 'terminal.app':
        saveTerminalApp(db, value as TerminalApp)
        break
      case 'terminal.openinbackground':
        saveTerminalOpenInBackground(db, value.toLowerCase() === 'true')
        break
      case 'shell':
        saveShell(db, value as Shell)
        break
      case 'tmux.controlmode':
        saveTmuxControlMode(db, value.toLowerCase() === 'true')
        break
      default:
        if (jsonMode) {
          outputErrorAsJson('UNKNOWN_KEY', `Unknown config key: ${key}`, createMetadata('config', {}))
        } else {
          this.warn(`Unknown config key: ${key}`)
        }
        return
    }

    if (jsonMode) {
      outputSuccessAsJson({ key, value }, createMetadata('config', {}))
    } else {
      this.log(styles.success(`Set ${key} = ${value}`))
    }
  }
}
