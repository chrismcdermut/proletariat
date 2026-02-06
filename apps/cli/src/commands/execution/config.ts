import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  loadExecutionConfig,
  saveTerminalApp,
  saveTerminalOpenInBackground,
  saveTmuxControlMode,
  saveShell,
  saveExecutionSetting,
} from '../../lib/execution/config.js'
import {
  TerminalApp,
  Shell,
  ExecutionEnvironment,
  OutputMode,
  DEFAULT_EXECUTION_CONFIG
} from '../../lib/execution/types.js'
import {
  shouldOutputJson,
  isAgentMode,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  normalizeChoices,
  type JsonFlags,
} from '../../lib/prompt-json.js'

export default class ExecutionConfig extends PMOCommand {
  static description = 'View and update execution preferences'

  static examples = [
    '<%= config.bin %> execution config                    # Interactive menu',
    '<%= config.bin %> execution config --json             # Output current config as JSON',
    '<%= config.bin %> execution config --list             # Show all settings',
    '<%= config.bin %> execution config --set defaultEnvironment host',
    '<%= config.bin %> execution config --set outputMode interactive',
    '<%= config.bin %> execution config --set sandboxed true',
    '<%= config.bin %> execution config --setting outputMode --json  # Show output mode choices',
  ]

  static flags = {
    ...pmoBaseFlags,
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

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  /**
   * Prompt wrapper - drop-in replacement for inquirer.prompt
   */
  private async promptUser<T extends Record<string, unknown>>(
    questions: Array<{
      type: string;
      name: string;
      message: string;
      choices?: Array<
        | string
        | { name: string; value: unknown; disabled?: boolean | string; command?: string }
        | unknown
      >;
      default?: unknown;
    }>,
    jsonModeConfig?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
    } | null
  ): Promise<T> {
    if (jsonModeConfig && isAgentMode(jsonModeConfig.flags)) {
      const firstQuestion = questions[0];
      if (firstQuestion) {
        const choices = firstQuestion.choices
          ? normalizeChoices(firstQuestion.choices)
          : undefined;

        outputPromptAsJson(
          {
            type: firstQuestion.type as 'list' | 'checkbox' | 'input' | 'confirm' | 'editor',
            name: firstQuestion.name,
            message: firstQuestion.message,
            choices,
            default: firstQuestion.default as string | boolean | string[] | undefined,
          },
          createMetadata(jsonModeConfig.commandName, jsonModeConfig.flags)
        );
      }
      return {} as T;
    }

    return inquirer.prompt(questions as Parameters<typeof inquirer.prompt>[0]) as Promise<T>;
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ExecutionConfig)
    const jsonMode = shouldOutputJson(flags)
    const jsonModeConfig = jsonMode ? { flags, commandName: 'execution config' } : null

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.', createMetadata('execution config', flags))
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
              outputErrorAsJson('INVALID_SET_FORMAT', `Invalid format: "${setValue}". Use: --set "key value"`, createMetadata('execution config', flags))
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
      if ((flags.list || flags.json) && !flags.setting) {
        if (jsonMode) {
          outputSuccessAsJson({
            terminal: {
              app: config.terminal.app,
              openInBackground: config.terminal.openInBackground,
            },
            shell: config.shell,
            tmux: {
              controlMode: config.tmux.controlMode,
            },
            defaultEnvironment: config.defaultEnvironment,
            defaultExecutor: config.defaultExecutor,
            outputMode: config.outputMode,
            sandboxed: config.sandboxed,
          }, createMetadata('execution config', flags))
        } else {
          this.log('')
          this.log(styles.header('Execution Configuration'))
          this.log('═'.repeat(50))
          this.log('')
          this.log(styles.emphasis('Environment'))
          this.log(`  defaultEnvironment: ${config.defaultEnvironment}`)
          this.log(`  defaultExecutor:    ${config.defaultExecutor}`)
          this.log('')
          this.log(styles.emphasis('Output'))
          this.log(`  outputMode:         ${config.outputMode}`)
          this.log(`  sandboxed:          ${config.sandboxed}`)
          this.log('')
          this.log(styles.emphasis('Terminal'))
          this.log(`  app:                ${config.terminal.app}`)
          this.log(`  openInBackground:   ${config.terminal.openInBackground}`)
          this.log('')
          this.log(styles.emphasis('Shell'))
          this.log(`  shell:              ${config.shell}`)
          this.log('')
          this.log(styles.emphasis('Tmux'))
          this.log(`  controlMode:        ${config.tmux.controlMode}`)
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
        { name: `Default Environment: ${config.defaultEnvironment}`, value: 'defaultEnvironment', command: 'prlt execution config --setting defaultEnvironment --json' },
        { name: `Output Mode: ${config.outputMode}`, value: 'outputMode', command: 'prlt execution config --setting outputMode --json' },
        { name: `Permission Mode: ${config.sandboxed ? 'safe' : 'danger'}`, value: 'sandboxed', command: 'prlt execution config --setting sandboxed --json' },
        { name: `Terminal App: ${config.terminal.app}`, value: 'terminal.app', command: 'prlt execution config --setting terminal.app --json' },
        { name: `Open Tabs in Background: ${config.terminal.openInBackground}`, value: 'terminal.openInBackground', command: 'prlt execution config --setting terminal.openInBackground --json' },
        { name: `Shell: ${config.shell}`, value: 'shell', command: 'prlt execution config --setting shell --json' },
        { name: `Tmux Control Mode: ${config.tmux.controlMode}`, value: 'tmux.controlMode', command: 'prlt execution config --setting tmux.controlMode --json' },
      ]

      const { setting } = await this.promptUser<{ setting: string }>([
        {
          type: 'list',
          name: 'setting',
          message: 'Select setting to configure:',
          choices: [
            new inquirer.Separator('── Execution ──'),
            ...settingChoices.slice(0, 3),
            new inquirer.Separator('── Terminal ──'),
            ...settingChoices.slice(3, 5),
            new inquirer.Separator('── Shell ──'),
            settingChoices[5],
            new inquirer.Separator('── Tmux ──'),
            settingChoices[6],
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
      case 'defaultEnvironment': {
        const envChoices = [
          { name: 'host - Run directly on host machine', value: 'host', command: 'prlt execution config --set "defaultEnvironment host" --json' },
          { name: 'devcontainer - Run in a devcontainer (sandboxed)', value: 'devcontainer', command: 'prlt execution config --set "defaultEnvironment devcontainer" --json' },
          { name: 'docker - Run in a Docker container', value: 'docker', command: 'prlt execution config --set "defaultEnvironment docker" --json' },
          { name: 'vm - Run on a remote VM', value: 'vm', command: 'prlt execution config --set "defaultEnvironment vm" --json' },
        ]
        const { newEnv } = await this.promptUser<{ newEnv: string }>([
          {
            type: 'list',
            name: 'newEnv',
            message: 'Select default execution environment:',
            choices: envChoices,
            default: config.defaultEnvironment,
          },
        ], jsonModeConfig)
        saveExecutionSetting(db, 'defaultMode', newEnv as ExecutionEnvironment)
        this.log(styles.success(`Default environment set to: ${newEnv}`))
        break
      }

      case 'outputMode': {
        const outputChoices = [
          { name: 'interactive - Watch Claude work in real-time (streaming UI)', value: 'interactive', command: 'prlt execution config --set "outputMode interactive" --json' },
          { name: 'print - Show final result only (better for logs)', value: 'print', command: 'prlt execution config --set "outputMode print" --json' },
        ]
        const { newOutput } = await this.promptUser<{ newOutput: string }>([
          {
            type: 'list',
            name: 'newOutput',
            message: 'Select output mode:',
            choices: outputChoices,
            default: config.outputMode,
          },
        ], jsonModeConfig)
        this.setConfigValue(db, 'outputMode', newOutput, false)
        this.log(styles.success(`Output mode set to: ${newOutput}`))
        break
      }

      case 'sandboxed': {
        const permChoices = [
          { name: 'safe - Requires approval for dangerous operations (recommended)', value: 'true', command: 'prlt execution config --set "sandboxed true" --json' },
          { name: 'danger - Skip permission checks (--dangerously-skip-permissions)', value: 'false', command: 'prlt execution config --set "sandboxed false" --json' },
        ]
        const { newPerm } = await this.promptUser<{ newPerm: string }>([
          {
            type: 'list',
            name: 'newPerm',
            message: 'Select permission mode:',
            choices: permChoices,
            default: String(config.sandboxed),
          },
        ], jsonModeConfig)
        this.setConfigValue(db, 'sandboxed', newPerm, false)
        this.log(styles.success(`Permission mode set to: ${newPerm === 'true' ? 'safe' : 'danger'}`))
        break
      }

      case 'terminal.app': {
        const appChoices = [
          { name: 'iTerm', value: 'iTerm', command: 'prlt execution config --set "terminal.app iTerm" --json' },
          { name: 'Terminal.app (macOS default)', value: 'Terminal', command: 'prlt execution config --set "terminal.app Terminal" --json' },
          { name: 'Ghostty', value: 'Ghostty', command: 'prlt execution config --set "terminal.app Ghostty" --json' },
          { name: 'Alacritty', value: 'Alacritty', command: 'prlt execution config --set "terminal.app Alacritty" --json' },
          { name: 'Kitty', value: 'Kitty', command: 'prlt execution config --set "terminal.app Kitty" --json' },
          { name: 'WezTerm', value: 'WezTerm', command: 'prlt execution config --set "terminal.app WezTerm" --json' },
          { name: 'Warp', value: 'Warp', command: 'prlt execution config --set "terminal.app Warp" --json' },
          { name: 'tmux', value: 'tmux', command: 'prlt execution config --set "terminal.app tmux" --json' },
        ]
        const { newApp } = await this.promptUser<{ newApp: string }>([
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
          { name: 'Yes - Open tabs in background (don\'t steal focus)', value: 'true', command: 'prlt execution config --set "terminal.openInBackground true" --json' },
          { name: 'No - Bring terminal to foreground when opening tabs', value: 'false', command: 'prlt execution config --set "terminal.openInBackground false" --json' },
        ]
        const { openInBg } = await this.promptUser<{ openInBg: string }>([
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
          { name: 'zsh (macOS default)', value: 'zsh', command: 'prlt execution config --set "shell zsh" --json' },
          { name: 'bash', value: 'bash', command: 'prlt execution config --set "shell bash" --json' },
          { name: 'fish', value: 'fish', command: 'prlt execution config --set "shell fish" --json' },
        ]
        const { newShell } = await this.promptUser<{ newShell: string }>([
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
          { name: 'Yes - Use tmux -CC for native iTerm integration', value: 'true', command: 'prlt execution config --set "tmux.controlMode true" --json' },
          { name: 'No - Standard tmux interface', value: 'false', command: 'prlt execution config --set "tmux.controlMode false" --json' },
        ]
        const { controlMode } = await this.promptUser<{ controlMode: string }>([
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
          outputErrorAsJson('UNKNOWN_SETTING', `Unknown setting: ${setting}`, createMetadata('execution config', jsonModeConfig?.flags ?? {}))
        }
        this.error(`Unknown setting: ${setting}`)
      }
    }
  }

  private setConfigValue(db: Database.Database, key: string, value: string, jsonMode: boolean): void {
    const normalizedKey = key.toLowerCase()

    // Define valid values for each config key
    const VALID_VALUES: Record<string, string[]> = {
      defaultenvironment: ['host', 'devcontainer', 'docker', 'vm'],
      outputmode: ['interactive', 'print'],
      sandboxed: ['true', 'false'],
      'terminal.app': ['Terminal', 'iTerm', 'Alacritty', 'Ghostty', 'Kitty', 'tmux', 'Warp', 'WezTerm'],
      'terminal.openinbackground': ['true', 'false'],
      shell: ['bash', 'zsh', 'fish'],
      'tmux.controlmode': ['true', 'false'],
    }

    // Validate value against allowed options
    const validValues = VALID_VALUES[normalizedKey]
    if (validValues && !validValues.includes(value)) {
      const errorMsg = `Invalid value "${value}" for ${key}. Valid options: ${validValues.join(', ')}`
      if (jsonMode) {
        outputErrorAsJson('INVALID_VALUE', errorMsg, createMetadata('execution config', {}))
      } else {
        this.error(errorMsg)
      }
      return
    }

    switch (normalizedKey) {
      case 'defaultenvironment':
        saveExecutionSetting(db, 'defaultMode', value)
        break
      case 'outputmode':
        // Store output mode - need to add this to the config storage
        this.setOutputMode(db, value as OutputMode)
        break
      case 'sandboxed':
        // Store sandboxed preference
        this.setSandboxed(db, value.toLowerCase() === 'true')
        break
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
          outputErrorAsJson('UNKNOWN_KEY', `Unknown config key: ${key}`, createMetadata('execution config', {}))
        } else {
          this.warn(`Unknown config key: ${key}`)
        }
        return
    }

    if (jsonMode) {
      outputSuccessAsJson({ key, value }, createMetadata('execution config', {}))
    } else {
      this.log(styles.success(`Set ${key} = ${value}`))
    }
  }

  /**
   * Save output mode to workspace settings
   */
  private setOutputMode(db: Database.Database, mode: OutputMode): void {
    db.prepare(`
      INSERT INTO workspace_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('execution.output_mode', mode)
  }

  /**
   * Save sandboxed preference to workspace settings
   */
  private setSandboxed(db: Database.Database, sandboxed: boolean): void {
    db.prepare(`
      INSERT INTO workspace_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('execution.sandboxed', sandboxed.toString())
  }
}
