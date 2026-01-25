import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { Command } from '@oclif/core'
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
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class Config extends Command {
  static description = 'View and update workspace configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Interactive menu',
    '<%= config.bin %> <%= command.id %> --json             # Output current config as JSON',
    '<%= config.bin %> <%= command.id %> --set terminal.app iTerm',
    '<%= config.bin %> <%= command.id %> --set terminal.openInBackground true',
  ]

  static flags = {
    json: Flags.boolean({
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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Config)
    const jsonMode = shouldOutputJson(flags)

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

      // Handle --list or --json flag (just show config)
      if (flags.list || flags.json) {
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

      // Interactive menu
      const settingChoices = [
        { name: `Terminal App: ${config.terminal.app}`, value: 'terminal.app' },
        { name: `Open Tabs in Background: ${config.terminal.openInBackground}`, value: 'terminal.openInBackground' },
        { name: `Shell: ${config.shell}`, value: 'shell' },
        { name: `Tmux Control Mode (iTerm -CC): ${config.tmux.controlMode}`, value: 'tmux.controlMode' },
      ]
      const settingMessage = 'Select setting to configure:'

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'setting', settingMessage, settingChoices),
          createMetadata('config', flags)
        )
        db.close()
        return
      }

      const { setting } = await inquirer.prompt([
        {
          type: 'list',
          name: 'setting',
          message: settingMessage,
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
      ])

      if (setting === '__exit__') {
        db.close()
        return
      }

      // Handle each setting
      switch (setting) {
        case 'terminal.app': {
          const appChoices = [
            { name: 'iTerm', value: 'iTerm' },
            { name: 'Terminal.app (macOS default)', value: 'Terminal' },
            { name: 'Ghostty', value: 'Ghostty' },
            { name: 'Alacritty', value: 'Alacritty' },
            { name: 'Kitty', value: 'Kitty' },
            { name: 'WezTerm', value: 'WezTerm' },
            { name: 'Warp', value: 'Warp' },
            { name: 'tmux', value: 'tmux' },
          ]
          const { newApp } = await inquirer.prompt([
            {
              type: 'list',
              name: 'newApp',
              message: 'Select terminal app:',
              choices: appChoices,
              default: config.terminal.app,
            },
          ])
          saveTerminalApp(db, newApp as TerminalApp)
          this.log(styles.success(`Terminal app set to: ${newApp}`))
          break
        }

        case 'terminal.openInBackground': {
          const bgChoices = [
            { name: 'Yes - Open tabs in background (don\'t steal focus)', value: true },
            { name: 'No - Bring terminal to foreground when opening tabs', value: false },
          ]
          const { openInBg } = await inquirer.prompt([
            {
              type: 'list',
              name: 'openInBg',
              message: 'Open terminal tabs in background?',
              choices: bgChoices,
              default: config.terminal.openInBackground,
            },
          ])
          saveTerminalOpenInBackground(db, openInBg)
          this.log(styles.success(`Open in background set to: ${openInBg}`))
          break
        }

        case 'shell': {
          const shellChoices = [
            { name: 'zsh (macOS default)', value: 'zsh' },
            { name: 'bash', value: 'bash' },
            { name: 'fish', value: 'fish' },
          ]
          const { newShell } = await inquirer.prompt([
            {
              type: 'list',
              name: 'newShell',
              message: 'Select shell:',
              choices: shellChoices,
              default: config.shell,
            },
          ])
          saveShell(db, newShell as Shell)
          this.log(styles.success(`Shell set to: ${newShell}`))
          break
        }

        case 'tmux.controlMode': {
          const ccChoices = [
            { name: 'Yes - Use tmux -CC for native iTerm integration', value: true },
            { name: 'No - Standard tmux interface', value: false },
          ]
          const { controlMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'controlMode',
              message: 'Enable tmux control mode (-CC)?',
              choices: ccChoices,
              default: config.tmux.controlMode,
            },
          ])
          saveTmuxControlMode(db, controlMode)
          this.log(styles.success(`Tmux control mode set to: ${controlMode}`))
          break
        }
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
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
