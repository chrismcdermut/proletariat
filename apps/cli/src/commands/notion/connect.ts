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
  NotionClient,
  isNotionConfigured,
  loadNotionConfig,
  saveNotionApiKey,
  saveNotionDefaultDatabase,
  getNotionApiKey,
} from '../../lib/notion/index.js'
import type { NotionDatabase } from '../../lib/notion/index.js'
import { upsertProviderSource } from '../../lib/work-source/provider-sources.js'

function databaseTitle(db: NotionDatabase): string {
  if (db.title && db.title.length > 0) {
    return db.title.map((t) => t.plain_text).join('').trim() || '(Untitled)'
  }
  return '(Untitled)'
}

export default class NotionConnect extends PMOCommand {
  static description = 'Connect to Notion: authenticate and select a default database'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --database <database-id>',
    'PRLT_NOTION_API_KEY=secret_... <%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Notion credentials are valid (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    database: Flags.string({
      description: 'Default Notion database ID (skips interactive picker)',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(NotionConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (flags.check) {
      return this.handleCheck(flags, jsonMode, db)
    }

    const existingConfig = loadNotionConfig(db)
    if (existingConfig && !flags.force && !flags.database) {
      try {
        const client = new NotionClient(existingConfig.apiKey)
        const info = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            workspace: info.workspaceName,
            defaultDatabaseId: existingConfig.defaultDatabaseId ?? null,
            defaultDatabaseName: existingConfig.defaultDatabaseName ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('notion connect', flags))
          return
        }

        this.log(colors.success('Already connected to Notion'))
        if (info.workspaceName) {
          this.log(colors.textMuted(`  Workspace: ${info.workspaceName}`))
        }
        if (existingConfig.defaultDatabaseName) {
          this.log(colors.textMuted(`  Database: ${existingConfig.defaultDatabaseName}`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate, or --database <id> to change the default database.'))
        return
      } catch {
        // Stored key invalid — proceed with re-auth
      }
    }

    let apiKey = existingConfig && !flags.force ? existingConfig.apiKey : getNotionApiKey(db)

    if (!apiKey || flags.force) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'Notion API key required. Set PRLT_NOTION_API_KEY or run interactively.',
          createMetadata('notion connect', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('Notion Authentication'))
      this.log('')
      this.log('Create an internal integration and copy its secret token at:')
      this.log(colors.textSecondary('  https://www.notion.so/profile/integrations'))
      this.log('')
      this.log(colors.textMuted('Then share the database you want to use with the integration:'))
      this.log(colors.textMuted('  Open the database → ⋯ menu → Connections → add your integration.'))
      this.log('')

      const { inputKey } = await inquirer.prompt([{
        type: 'password',
        name: 'inputKey',
        message: 'Enter your Notion integration token:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'Token is required'
          return true
        },
      }])
      apiKey = inputKey
    }

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'Notion API key required.',
          createMetadata('notion connect', flags),
        )
        return
      }
      this.error('Notion API key is required.')
    }

    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying Notion token...'))
    }

    let client: NotionClient
    let workspaceName = ''
    try {
      client = new NotionClient(apiKey)
      const info = await client.verify()
      workspaceName = info.workspaceName
      saveNotionApiKey(db, apiKey)

      if (!jsonMode) {
        const labelSuffix = workspaceName ? ` to ${workspaceName}` : ''
        this.log(colors.success(`Connected${labelSuffix}`))
      }
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('NOTION_CONNECT_FAILED', message, createMetadata('notion connect', flags))
        return
      }
      this.error(message)
    }

    await this.handleDatabaseSelection(client, flags, jsonMode, db, workspaceName)
  }

  private async handleCheck(
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
  ): Promise<void> {
    if (!isNotionConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'NOTION_NOT_CONFIGURED',
          'Notion is not configured. Run "prlt notion connect" to authenticate.',
          createMetadata('notion connect', flags),
        )
        return
      }
      this.log(colors.warning('Notion is not configured.'))
      this.log(colors.textMuted('Run "prlt notion connect" to authenticate.'))
      this.exit(1)
      return
    }

    const apiKey = getNotionApiKey(db)
    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson('NOTION_NOT_CONFIGURED', 'Notion API key missing.', createMetadata('notion connect', flags))
        return
      }
      this.log(colors.warning('Notion API key missing.'))
      this.exit(1)
      return
    }

    const config = loadNotionConfig(db)
    try {
      const client = new NotionClient(apiKey)
      const info = await client.verify()
      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          workspace: info.workspaceName,
          defaultDatabaseId: config?.defaultDatabaseId ?? null,
          defaultDatabaseName: config?.defaultDatabaseName ?? null,
        }, createMetadata('notion connect', flags))
        return
      }
      this.log(colors.success('Notion connection is active'))
      if (info.workspaceName) {
        this.log(colors.textMuted(`  Workspace: ${info.workspaceName}`))
      }
      if (config?.defaultDatabaseName) {
        this.log(colors.textMuted(`  Database: ${config.defaultDatabaseName}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'NOTION_AUTH_INVALID',
          `Stored Notion token is invalid or expired: ${message}`,
          createMetadata('notion connect', flags),
        )
        return
      }
      this.log(colors.error('Stored Notion token is invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt notion connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }

  private async handleDatabaseSelection(
    client: NotionClient,
    flags: { database?: string } & Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
    workspaceName: string,
  ): Promise<void> {
    // Explicit database flag — fetch and confirm
    if (flags.database) {
      try {
        const database = await client.getDatabase(flags.database)
        const name = databaseTitle(database)
        saveNotionDefaultDatabase(db, database.id, name)
        upsertProviderSource(db, {
          id: 'notion',
          provider: 'notion',
          apiKeyRef: 'notion.api_key',
          teamProjectId: database.id,
          prefix: 'NOT-',
          label: name,
        })

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            workspace: workspaceName,
            defaultDatabaseId: database.id,
            defaultDatabaseName: name,
          }, createMetadata('notion connect', flags))
          return
        }
        this.log(colors.textMuted(`  Default database: ${name}`))
        this.log('')
        this.log(colors.success('Notion integration configured!'))
        return
      } catch (error) {
        const message = `Could not access database "${flags.database}": ${error instanceof Error ? error.message : String(error)}`
        if (jsonMode) {
          outputErrorAsJson('NOTION_DATABASE_NOT_FOUND', message, createMetadata('notion connect', flags))
          return
        }
        this.error(message)
      }
    }

    // List databases the integration can see
    let databases: NotionDatabase[]
    try {
      databases = await client.searchDatabases()
    } catch (error) {
      const message = `Failed to list Notion databases: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('NOTION_SEARCH_FAILED', message, createMetadata('notion connect', flags))
        return
      }
      this.error(message)
    }

    if (databases.length === 0) {
      const hint = 'No databases visible to this integration. Open the database in Notion → ⋯ → Connections → add your integration, then re-run.'
      if (jsonMode) {
        outputErrorAsJson('NOTION_NO_DATABASES', hint, createMetadata('notion connect', flags))
        return
      }
      this.log(colors.warning(hint))
      this.exit(1)
      return
    }

    if (jsonMode) {
      const choices = databases.map((d) => ({
        name: databaseTitle(d),
        value: d.id,
      }))
      outputPromptAsJson(
        buildPromptConfig('list', 'database', 'Select default Notion database:', choices),
        createMetadata('notion connect', flags),
      )
      return
    }

    let selectedId: string
    let selectedName: string
    if (databases.length === 1) {
      selectedId = databases[0].id
      selectedName = databaseTitle(databases[0])
      this.log(colors.textMuted(`  Default database: ${selectedName}`))
    } else {
      const choices = databases.map((d) => ({
        name: databaseTitle(d),
        value: d.id,
      }))
      const { picked } = await inquirer.prompt([{
        type: 'list',
        name: 'picked',
        message: 'Select default Notion database:',
        choices,
      }])
      selectedId = picked
      selectedName = databaseTitle(databases.find((d) => d.id === picked)!)
      this.log(colors.textMuted(`  Default database: ${selectedName}`))
    }

    saveNotionDefaultDatabase(db, selectedId, selectedName)
    upsertProviderSource(db, {
      id: 'notion',
      provider: 'notion',
      apiKeyRef: 'notion.api_key',
      teamProjectId: selectedId,
      prefix: 'NOT-',
      label: selectedName,
    })

    this.log('')
    this.log(colors.success('Notion integration configured!'))
    this.log(colors.textMuted('  Run "prlt ticket list" to see Notion pages.'))
  }
}
