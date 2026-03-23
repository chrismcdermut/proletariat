import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import inquirer from 'inquirer'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  loadExecutionConfig,
  saveTerminalApp,
  saveTerminalOpenInBackground,
  saveTmuxControlMode,
  saveShell,
  getMirrorToPmoDefault,
  saveCreatePrDefault,
  saveMirrorToPmoDefault,
  saveFirewallAllowlistDomains,
} from '../../lib/execution/config.js'
import { getReviewGateSetting, setReviewGateSetting, isValidReviewGateMode } from '../../lib/pmo/utils.js'
import { TerminalApp, Shell } from '../../lib/execution/types.js'
import { readWorkspaceConfig, writeWorkspaceConfig, getClaudeCodeConfig, updateClaudeCodeConfig } from '../../lib/workspace-config.js'
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
    '<%= config.bin %> <%= command.id %> --set firewall.allowlistDomains "api.staging.example.com"',
    '<%= config.bin %> <%= command.id %> --set review_gate auto        # Set workspace review gate to auto',
    '<%= config.bin %> <%= command.id %> --set claude-code.version 2.1.80  # Pin Claude Code version',
    '<%= config.bin %> <%= command.id %> --setting terminal.app --json  # Show terminal app choices',
  ]

  static flags = {
    ...machineOutputFlags,
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
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('config', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = SqliteDatabase.open(dbPath)

    try {
      // Load current config
      const config = loadExecutionConfig(db)
      const mirrorToPmoDefault = getMirrorToPmoDefault(db)
      const reviewGate = getReviewGateSetting(db)

      // Handle --set flag
      if (flags.set && flags.set.length > 0) {
        for (const setValue of flags.set) {
          const [key, ...valueParts] = setValue.split(' ')
          const value = valueParts.join(' ')

          if (!key || !value) {
            if (jsonMode) {
              outputErrorAsJson('INVALID_SET_FORMAT', `Invalid format: "${setValue}". Use: --set "key value"`, createMetadata('config', flags))
              return
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

      // Load Claude Code config from workspace config.json
      const claudeCodeConfig = getClaudeCodeConfig(workspaceInfo.path)

      // Handle --list or --json flag without --setting (just show config)
      // Also handle non-TTY mode without explicit flags - output config as readable list
      const shouldShowConfigList = flags.list || (jsonMode && !flags.setting) || (isNonTTY() && !flags.setting && !flags.set?.length)

      if (shouldShowConfigList) {
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
            permissionMode: config.permissionMode,
            createPrDefault: config.createPrDefault ?? null,
            mirrorToPmoDefault,
            reviewGate,
            firewall: {
              allowlistDomains: config.firewall.allowlistDomains,
            },
            claudeCode: {
              version: claudeCodeConfig.version ?? null,
            },
          }, createMetadata('config', flags))
          return
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
          this.log(`  permissionMode:   ${config.permissionMode}`)
          this.log(`  createPrDefault:  ${config.createPrDefault ?? 'not set (will prompt)'}`)
          this.log(`  mirrorToPmoDefault: ${mirrorToPmoDefault ?? 'not set (default: true)'}`)
          this.log(`  reviewGate:       ${reviewGate}`)
          this.log(`  firewall.allowlistDomains: ${config.firewall.allowlistDomains.join(', ') || '(none)'}`)
          this.log('')
          this.log(styles.emphasis('Claude Code'))
          this.log(`  version:          ${claudeCodeConfig.version ?? 'latest (not pinned)'}`)
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
        { name: `Firewall allowlist domains: ${config.firewall.allowlistDomains.length || 0}`, value: 'firewall.allowlistDomains', command: 'prlt config --setting firewall.allowlistDomains --json' },
        { name: `Review Gate: ${reviewGate}`, value: 'review_gate', command: 'prlt config --setting review_gate --json' },
        { name: `Claude Code Version: ${claudeCodeConfig.version ?? 'latest (not pinned)'}`, value: 'claude-code.version', command: 'prlt config --setting claude-code.version --json' },
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
            new inquirer.Separator('── Execution ──'),
            settingChoices[4],
            new inquirer.Separator('── Review ──'),
            settingChoices[5],
            new inquirer.Separator('── Agent Containers ──'),
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
    db: SqliteDatabase,
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

      case 'review_gate': {
        const currentGate = getReviewGateSetting(db)
        const gateChoices = [
          { name: 'required — Agent creates PR, human approves before landing (default)', value: 'required', command: 'prlt config --set "review_gate required" --json' },
          { name: 'auto — Agent ships directly, no approval gate', value: 'auto', command: 'prlt config --set "review_gate auto" --json' },
          { name: 'post — Agent ships immediately, human reviews after', value: 'post', command: 'prlt config --set "review_gate post" --json' },
        ]
        const { newGate } = await this.prompt<{ newGate: string }>([
          {
            type: 'list',
            name: 'newGate',
            message: 'Select review gate mode:',
            choices: gateChoices,
            default: currentGate,
          },
        ], jsonModeConfig)
        setReviewGateSetting(db, newGate as 'required' | 'auto' | 'post')
        this.log(styles.success(`Review gate set to: ${newGate}`))
        break
      }

      case 'firewall.allowlistDomains': {
        const { domainsInput } = await this.prompt<{ domainsInput: string }>([
          {
            type: 'input',
            name: 'domainsInput',
            message: 'Extra firewall allowlist domains (comma-separated, leave empty to clear):',
            default: config.firewall.allowlistDomains.join(', '),
          },
        ], jsonModeConfig)

        const domains = domainsInput
          .split(',')
          .map(domain => domain.trim())
          .filter(Boolean)
        saveFirewallAllowlistDomains(db, domains)
        this.log(styles.success(`Firewall allowlist domains set (${domains.length})`))
        break
      }

      case 'claude-code.version': {
        let workspaceInfo2
        try {
          workspaceInfo2 = getWorkspaceInfo()
        } catch {
          if (jsonModeConfig) {
            outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace.', createMetadata('config', jsonModeConfig.flags))
            return
          }
          this.error('Not in a workspace.')
          return
        }
        const currentCcConfig = getClaudeCodeConfig(workspaceInfo2.path)
        const { ccVersion } = await this.prompt<{ ccVersion: string }>([
          {
            type: 'input',
            name: 'ccVersion',
            message: 'Claude Code version (e.g., "2.1.80", leave empty for latest):',
            default: currentCcConfig.version || '',
          },
        ], jsonModeConfig)

        const trimmedVersion = ccVersion.trim()
        updateClaudeCodeConfig(workspaceInfo2.path, {
          version: trimmedVersion || undefined,
        })
        this.log(styles.success(trimmedVersion
          ? `Claude Code version pinned to: ${trimmedVersion}`
          : `Claude Code version unpinned (will use latest)`))
        break
      }

      default: {
        const jsonMode = shouldOutputJson(jsonModeConfig?.flags ?? {})
        if (jsonMode) {
          outputErrorAsJson('UNKNOWN_SETTING', `Unknown setting: ${setting}`, createMetadata('config', jsonModeConfig?.flags ?? {}))
          return
        }
        this.error(`Unknown setting: ${setting}`)
      }
    }
  }

  private setConfigValue(db: SqliteDatabase, key: string, value: string, jsonMode: boolean): void {
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
      case 'execution.create_pr_default':
        saveCreatePrDefault(db, value.toLowerCase() === 'true')
        break
      case 'execution.mirror_to_pmo_default':
        saveMirrorToPmoDefault(db, value.toLowerCase() === 'true')
        break
      case 'review_gate':
      case 'reviewgate':
        if (!isValidReviewGateMode(value)) {
          if (jsonMode) {
            outputErrorAsJson('INVALID_VALUE', `Invalid review gate mode: "${value}". Must be: required, auto, or post`, createMetadata('config', {}))
            return
          } else {
            this.error(`Invalid review gate mode: "${value}". Must be: required, auto, or post`)
          }
          return
        }
        setReviewGateSetting(db, value as 'required' | 'auto' | 'post')
        break
      case 'firewall.allowlistdomains': {
        const domains = value
          .split(',')
          .map(domain => domain.trim())
          .filter(Boolean)
        saveFirewallAllowlistDomains(db, domains)
        break
      }
      case 'claude-code.version': {
        let workspaceInfo3
        try {
          workspaceInfo3 = getWorkspaceInfo()
        } catch {
          if (jsonMode) {
            outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace.', createMetadata('config', {}))
            return
          }
          this.warn('Not in a workspace.')
          return
        }
        const trimmed = value.trim()
        updateClaudeCodeConfig(workspaceInfo3.path, {
          version: trimmed || undefined,
        })
        break
      }
      default:
        if (jsonMode) {
          outputErrorAsJson('UNKNOWN_KEY', `Unknown config key: ${key}`, createMetadata('config', {}))
          return
        } else {
          this.warn(`Unknown config key: ${key}`)
        }
        return
    }

    if (jsonMode) {
      outputSuccessAsJson({ key, value }, createMetadata('config', {}))
      return
    } else {
      this.log(styles.success(`Set ${key} = ${value}`))
    }
  }
}
