import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  ClickUpClient,
  isClickUpConfigured,
  loadClickUpConfig,
  saveClickUpApiKey,
  saveClickUpWorkspace,
  saveClickUpSpace,
  clearClickUpConfig,
  getClickUpApiKey,
} from '../../lib/clickup/index.js'
import { upsertProviderSource, removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'

export default class ClickUpConnect extends PMOCommand {
  static description = 'Connect to ClickUp workspace and configure authentication'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --disconnect',
    'CLICKUP_API_KEY=pk_... <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if ClickUp credentials are valid (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored ClickUp credentials and configuration',
      default: false,
    }),
    workspace: Flags.string({
      description: 'Workspace ID for non-interactive setup',
    }),
    space: Flags.string({
      description: 'Space ID for non-interactive setup',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ClickUpConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearClickUpConfig(db)
      removeProviderSourcesByProvider(db, 'clickup')
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'ClickUp credentials and configuration removed.',
        }, createMetadata('clickup connect', flags))
        return
      }
      this.log(colors.success('ClickUp credentials and configuration removed.'))
      return
    }

    // Handle --check (health check)
    if (flags.check) {
      return this.handleCheck(flags, jsonMode, db)
    }

    // Check for existing config
    const existingConfig = loadClickUpConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new ClickUpClient(existingConfig.apiKey)
        const info = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: info.userName,
            workspace: existingConfig.workspaceName ?? null,
            space: existingConfig.spaceName ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('clickup connect', flags))
          return
        }
        this.log(colors.success('Already connected to ClickUp'))
        this.log(colors.textMuted(`  User: ${info.userName}`))
        if (existingConfig.workspaceName) {
          this.log(colors.textMuted(`  Workspace: ${existingConfig.workspaceName}`))
        }
        if (existingConfig.spaceName) {
          this.log(colors.textMuted(`  Space: ${existingConfig.spaceName}`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored key is bad, proceed with re-auth
      }
    }

    // Try environment variable first
    let apiKey = getClickUpApiKey(db)

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'ClickUp API key required. Set PRLT_CLICKUP_API_KEY or CLICKUP_API_KEY environment variable, or run interactively.',
          createMetadata('clickup connect', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('ClickUp Authentication'))
      this.log('')
      this.log('Create a personal API token at:')
      this.log(colors.textSecondary('  https://app.clickup.com/settings/apps'))
      this.log('')

      const { inputKey } = await inquirer.prompt([{
        type: 'password',
        name: 'inputKey',
        message: 'Enter your ClickUp API key:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API key is required'
          if (!input.startsWith('pk_')) return 'ClickUp API keys start with "pk_"'
          return true
        },
      }])
      apiKey = inputKey
    }

    // Verify the API key
    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying API key...'))
    }

    let client: ClickUpClient
    try {
      client = new ClickUpClient(apiKey!)
      const info = await client.verify()

      // Save API key
      saveClickUpApiKey(db, apiKey!)

      if (!jsonMode) {
        this.log(colors.success(`Connected as ${info.userName}`))
      }

      // Handle workspace and space selection
      await this.handleWorkspaceAndSpaceSelection(client, flags, jsonMode, db, info)
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_CONNECT_FAILED', message, createMetadata('clickup connect', flags))
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
    if (!isClickUpConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'CLICKUP_NOT_CONFIGURED',
          'ClickUp is not configured. Run "prlt clickup connect" to authenticate.',
          createMetadata('clickup connect', flags),
        )
        return
      }
      this.log(colors.warning('ClickUp is not configured.'))
      this.log(colors.textMuted('Run "prlt clickup connect" to authenticate.'))
      this.exit(1)
      return
    }

    const config = loadClickUpConfig(db)!
    try {
      const client = new ClickUpClient(config.apiKey)
      const info = await client.verify()

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          user: info.userName,
          workspace: config.workspaceName ?? null,
          space: config.spaceName ?? null,
        }, createMetadata('clickup connect', flags))
        return
      }

      this.log(colors.success('ClickUp connection is active'))
      this.log(colors.textMuted(`  User: ${info.userName}`))
      if (config.workspaceName) {
        this.log(colors.textMuted(`  Workspace: ${config.workspaceName}`))
      }
      if (config.spaceName) {
        this.log(colors.textMuted(`  Space: ${config.spaceName}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'CLICKUP_AUTH_INVALID',
          `Stored ClickUp API key is invalid or expired: ${message}`,
          createMetadata('clickup connect', flags),
        )
        return
      }
      this.log(colors.error('Stored ClickUp API key is invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt clickup connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }

  private async handleWorkspaceAndSpaceSelection(
    client: ClickUpClient,
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
    info: { userName: string; workspaces: import('../../lib/clickup/types.js').ClickUpWorkspace[] },
  ): Promise<void> {
    const workspaces = info.workspaces

    if (workspaces.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: info.userName,
          workspace: null,
          space: null,
          message: 'No workspaces found.',
        }, createMetadata('clickup connect', flags))
        return
      }
      this.log(colors.warning('No workspaces found in your ClickUp account.'))
      return
    }

    // Select workspace
    let selectedWorkspace: typeof workspaces[0]

    if (flags.workspace) {
      const match = workspaces.find(w => w.id === flags.workspace || w.name.toLowerCase() === (flags.workspace as string).toLowerCase())
      if (!match) {
        const available = workspaces.map(w => `${w.name} (${w.id})`).join(', ')
        const message = `Workspace "${flags.workspace}" not found. Available: ${available}`
        if (jsonMode) {
          outputErrorAsJson('WORKSPACE_NOT_FOUND', message, createMetadata('clickup connect', flags))
          return
        }
        this.error(message)
        return
      }
      selectedWorkspace = match
    } else if (workspaces.length === 1) {
      selectedWorkspace = workspaces[0]
      if (!jsonMode) {
        this.log(colors.textMuted(`  Workspace: ${selectedWorkspace.name}`))
      }
    } else {
      if (jsonMode) {
        const choices = workspaces.map(w => ({
          name: w.name,
          value: w.id,
        }))
        outputPromptAsJson(
          buildPromptConfig('list', 'workspace', 'Select a workspace:', choices),
          createMetadata('clickup connect', flags),
        )
        return
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select your workspace:',
        choices: workspaces.map(w => ({
          name: w.name,
          value: w.id,
        })),
      }])
      selectedWorkspace = workspaces.find(w => w.id === selectedId)!
    }

    saveClickUpWorkspace(db, selectedWorkspace.id, selectedWorkspace.name)

    // Select space
    const spaces = await client.listSpaces(selectedWorkspace.id)

    if (spaces.length === 0) {
      upsertProviderSource(db, {
        id: 'clickup',
        provider: 'clickup',
        apiKeyRef: 'clickup.api_key',
        teamProjectId: selectedWorkspace.id,
        prefix: 'CU-',
        label: selectedWorkspace.name,
      })

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: info.userName,
          workspace: selectedWorkspace.name,
          space: null,
          message: 'No spaces found in workspace.',
        }, createMetadata('clickup connect', flags))
        return
      }
      this.log(colors.warning('No spaces found in the selected workspace.'))
      this.log('')
      this.log(colors.success('ClickUp integration configured!'))
      return
    }

    let selectedSpace: typeof spaces[0]

    if (flags.space) {
      const match = spaces.find(s => s.id === flags.space || s.name.toLowerCase() === (flags.space as string).toLowerCase())
      if (!match) {
        const available = spaces.map(s => `${s.name} (${s.id})`).join(', ')
        const message = `Space "${flags.space}" not found. Available: ${available}`
        if (jsonMode) {
          outputErrorAsJson('SPACE_NOT_FOUND', message, createMetadata('clickup connect', flags))
          return
        }
        this.error(message)
        return
      }
      selectedSpace = match
    } else if (spaces.length === 1) {
      selectedSpace = spaces[0]
      if (!jsonMode) {
        this.log(colors.textMuted(`  Space: ${selectedSpace.name}`))
      }
    } else {
      if (jsonMode) {
        const choices = spaces.map(s => ({
          name: s.name,
          value: s.id,
        }))
        outputPromptAsJson(
          buildPromptConfig('list', 'space', 'Select a space:', choices),
          createMetadata('clickup connect', flags),
        )
        return
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select your default space:',
        choices: spaces.map(s => ({
          name: s.name,
          value: s.id,
        })),
      }])
      selectedSpace = spaces.find(s => s.id === selectedId)!
    }

    saveClickUpSpace(db, selectedSpace.id, selectedSpace.name)

    // Register as provider source
    upsertProviderSource(db, {
      id: 'clickup',
      provider: 'clickup',
      apiKeyRef: 'clickup.api_key',
      teamProjectId: selectedSpace.id,
      prefix: 'CU-',
      label: `${selectedWorkspace.name} / ${selectedSpace.name}`,
    })

    if (jsonMode) {
      outputSuccessAsJson({
        authenticated: true,
        user: info.userName,
        workspace: selectedWorkspace.name,
        space: selectedSpace.name,
      }, createMetadata('clickup connect', flags))
      return
    }

    this.log('')
    this.log(colors.success('ClickUp integration configured!'))
    this.log(colors.textMuted('  Run "prlt clickup import" to pull tasks into PMO'))
  }
}
