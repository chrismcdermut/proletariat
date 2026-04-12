import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  _outputPromptAsJson,
  _buildPromptConfig,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  isShortcutConfigured,
  loadShortcutConfig,
  saveShortcutApiToken,
  _saveShortcutWorkspaceSlug,
  clearShortcutConfig,
  getShortcutApiToken,
} from '../../lib/shortcut/index.js'
import { upsertProviderSource, removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'

const SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3'

interface ShortcutMemberInfo {
  id: string
  profile: {
    name: string
    email_address: string
    mention_name: string
  }
}

async function verifyShortcutToken(
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ userName: string; email: string; mentionName: string }> {
  const response = await fetchImpl(`${SHORTCUT_API_URL}/member`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Shortcut-Token': apiToken,
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('Invalid or expired Shortcut API token.')
  }

  if (!response.ok) {
    throw new Error(`Shortcut API request failed with status ${response.status}.`)
  }

  const data = await response.json() as ShortcutMemberInfo
  return {
    userName: data.profile?.name || 'Unknown',
    email: data.profile?.email_address || '',
    mentionName: data.profile?.mention_name || '',
  }
}

export default class ShortcutConnect extends PMOCommand {
  static description = 'Connect to Shortcut workspace and configure authentication'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --disconnect',
    'SHORTCUT_API_TOKEN=... <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Shortcut credentials are valid (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Shortcut credentials and configuration',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ShortcutConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearShortcutConfig(db)
      removeProviderSourcesByProvider(db, 'shortcut')
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Shortcut credentials and configuration removed.',
        }, createMetadata('shortcut connect', flags))
        return
      }
      this.log(colors.success('Shortcut credentials and configuration removed.'))
      return
    }

    // Handle --check (health check)
    if (flags.check) {
      return this.handleCheck(flags, jsonMode, db)
    }

    // Check for existing config
    const existingConfig = loadShortcutConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const info = await verifyShortcutToken(existingConfig.apiToken)

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: info.userName,
            email: info.email,
            mentionName: info.mentionName,
            workspaceSlug: existingConfig.workspaceSlug ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('shortcut connect', flags))
          return
        }
        this.log(colors.success('Already connected to Shortcut'))
        this.log(colors.textMuted(`  User: ${info.userName} (${info.email})`))
        if (existingConfig.workspaceSlug) {
          this.log(colors.textMuted(`  Workspace: ${existingConfig.workspaceSlug}`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored token is bad, proceed with re-auth
      }
    }

    // Try environment variable first
    let apiToken = getShortcutApiToken(db)

    if (!apiToken) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_TOKEN_REQUIRED',
          'Shortcut API token required. Set SHORTCUT_API_TOKEN or PRLT_SHORTCUT_API_TOKEN environment variable, or run interactively.',
          createMetadata('shortcut connect', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('Shortcut Authentication'))
      this.log('')
      this.log('Create an API token at:')
      this.log(colors.textSecondary('  https://app.shortcut.com/settings/account/api-tokens'))
      this.log('')

      const { inputToken } = await inquirer.prompt([{
        type: 'password',
        name: 'inputToken',
        message: 'Enter your Shortcut API token:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API token is required'
          return true
        },
      }])
      apiToken = inputToken
    }

    // Verify the API token
    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying API token...'))
    }

    try {
      const info = await verifyShortcutToken(apiToken!)

      // Save API token
      saveShortcutApiToken(db, apiToken!)

      // Register as provider source
      upsertProviderSource(db, {
        id: 'shortcut',
        provider: 'shortcut',
        apiKeyRef: 'shortcut.api_token',
        teamProjectId: 'default',
        prefix: 'SC-',
        label: 'Shortcut',
      })

      if (!jsonMode) {
        this.log(colors.success('Connected to Shortcut'))
        this.log(colors.textMuted(`  Signed in as ${info.userName} (${info.email})`))
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: info.userName,
          email: info.email,
          mentionName: info.mentionName,
        }, createMetadata('shortcut connect', flags))
        return
      }

      this.log('')
      this.log(colors.success('Shortcut integration configured!'))
      this.log(colors.textMuted('  Run "prlt work shortcut" to pull stories and spawn agents'))
      this.log(colors.textMuted('  Run "prlt work spawn --from shortcut" to use as default source'))
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('SHORTCUT_CONNECT_FAILED', message, createMetadata('shortcut connect', flags))
        return
      }
      this.error(message)
    }
  }

  private async handleCheck(
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
  ): Promise<void> {
    if (!isShortcutConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'SHORTCUT_NOT_CONFIGURED',
          'Shortcut is not configured. Run "prlt shortcut connect" to authenticate.',
          createMetadata('shortcut connect', flags),
        )
        return
      }
      this.log(colors.warning('Shortcut is not configured.'))
      this.log(colors.textMuted('Run "prlt shortcut connect" to authenticate.'))
      this.exit(1)
      return
    }

    const config = loadShortcutConfig(db)!
    try {
      const info = await verifyShortcutToken(config.apiToken)

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          user: info.userName,
          email: info.email,
          mentionName: info.mentionName,
          workspaceSlug: config.workspaceSlug ?? null,
        }, createMetadata('shortcut connect', flags))
        return
      }

      this.log(colors.success('Shortcut connection is active'))
      this.log(colors.textMuted(`  User: ${info.userName} (${info.email})`))
      if (config.workspaceSlug) {
        this.log(colors.textMuted(`  Workspace: ${config.workspaceSlug}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'SHORTCUT_AUTH_INVALID',
          `Stored Shortcut API token is invalid or expired: ${message}`,
          createMetadata('shortcut connect', flags),
        )
        return
      }
      this.log(colors.error('Stored Shortcut API token is invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt shortcut connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }
}
