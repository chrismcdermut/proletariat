import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import type { SqliteDatabase } from '../../lib/database/sqlite.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  TrelloClient,
  clearTrelloConfig,
  getTrelloApiKey,
  getTrelloApiToken,
  isTrelloConfigured,
  loadTrelloConfig,
  saveTrelloApiKey,
  saveTrelloApiToken,
  saveTrelloBoard,
} from '../../lib/trello/index.js'
import { upsertProviderSource, removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'

export default class TrelloConfigure extends PMOCommand {
  static description = 'Connect to Trello and configure authentication'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --disconnect',
    'TRELLO_API_KEY=... TRELLO_API_TOKEN=... <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Trello credentials are valid (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Trello credentials and configuration',
      default: false,
    }),
    board: Flags.string({
      description: 'Default board ID or name',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TrelloConfigure)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearTrelloConfig(db)
      removeProviderSourcesByProvider(db, 'trello')
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Trello credentials and configuration removed.',
        }, createMetadata('trello configure', flags))
        return
      }
      this.log(colors.success('Trello credentials and configuration removed.'))
      return
    }

    // Handle --check (health check)
    if (flags.check) {
      return this.handleCheck(flags, jsonMode, db)
    }

    // Check for existing config
    const existingConfig = loadTrelloConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new TrelloClient(existingConfig.apiKey, existingConfig.apiToken)
        const member = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: member.fullName,
            username: member.username,
            board: existingConfig.boardName ?? existingConfig.boardId ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('trello configure', flags))
          return
        }
        this.log(colors.success('Already connected to Trello'))
        this.log(colors.textMuted(`  User: ${member.fullName} (@${member.username})`))
        if (existingConfig.boardName) {
          this.log(colors.textMuted(`  Board: ${existingConfig.boardName}`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored credentials are bad, proceed with re-auth
      }
    }

    // Try environment variable first
    let apiKey = getTrelloApiKey(db)
    let apiToken = getTrelloApiToken(db)

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'Trello API key required. Set TRELLO_API_KEY or PRLT_TRELLO_API_KEY environment variable, or run interactively.',
          createMetadata('trello configure', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('Trello Authentication'))
      this.log('')
      this.log('Get your API key at:')
      this.log(colors.textSecondary('  https://trello.com/power-ups/admin'))
      this.log('')

      const { inputKey } = await inquirer.prompt([{
        type: 'password',
        name: 'inputKey',
        message: 'Enter your Trello API key:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API key is required'
          return true
        },
      }])
      apiKey = inputKey
    }

    if (!apiToken) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_TOKEN_REQUIRED',
          'Trello API token required. Set TRELLO_API_TOKEN or PRLT_TRELLO_API_TOKEN environment variable, or run interactively.',
          createMetadata('trello configure', flags),
        )
        return
      }

      this.log('')
      this.log('Generate an API token at:')
      this.log(colors.textSecondary(`  https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=prlt&key=${apiKey}`))
      this.log('')

      const { inputToken } = await inquirer.prompt([{
        type: 'password',
        name: 'inputToken',
        message: 'Enter your Trello API token:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API token is required'
          return true
        },
      }])
      apiToken = inputToken
    }

    // Verify the credentials
    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying Trello credentials...'))
    }

    try {
      const client = new TrelloClient(apiKey!, apiToken!)
      const member = await client.verify()

      // Save credentials
      saveTrelloApiKey(db, apiKey!)
      saveTrelloApiToken(db, apiToken!)

      if (!jsonMode) {
        this.log(colors.success('Connected to Trello'))
        this.log(colors.textMuted(`  Signed in as ${member.fullName} (@${member.username})`))
      }

      // Board selection
      let boardId: string | undefined
      let boardName: string | undefined

      if (flags.board) {
        const boards = await client.getBoards()
        const matched = boards.find(b =>
          b.id === flags.board || b.name.toLowerCase() === flags.board!.toLowerCase(),
        )
        if (matched) {
          boardId = matched.id
          boardName = matched.name
        } else {
          throw new Error(`Board "${flags.board}" not found`)
        }
      } else if (!jsonMode) {
        const boards = await client.getBoards()
        if (boards.length > 0) {
          const { selectedBoard } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedBoard',
            message: 'Select default Trello board (optional):',
            choices: [
              { name: 'Skip', value: null },
              ...boards.map((board) => ({
                name: board.name,
                value: board.id,
              })),
            ],
            default: null,
          }])

          if (selectedBoard) {
            const selected = boards.find(b => b.id === selectedBoard)
            boardId = selected?.id
            boardName = selected?.name
          }
        }
      }

      if (boardId && boardName) {
        saveTrelloBoard(db, boardId, boardName)
      }

      // Register as provider source
      upsertProviderSource(db, {
        id: 'trello',
        provider: 'trello',
        apiKeyRef: 'trello.api_key',
        teamProjectId: boardId ?? 'default',
        prefix: 'TRL-',
        label: boardName ?? 'Trello',
      })

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: member.fullName,
          username: member.username,
          board: boardName ?? null,
        }, createMetadata('trello configure', flags))
        return
      }

      if (boardName) {
        this.log(colors.textMuted(`  Board: ${boardName}`))
      }

      this.log('')
      this.log(colors.success('Trello integration configured!'))
      this.log(colors.textMuted('  Run "prlt trello import" to import cards as tickets'))
      this.log(colors.textMuted('  Run "prlt trello sync" to sync mapped tickets'))
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('TRELLO_CONNECT_FAILED', message, createMetadata('trello configure', flags))
        return
      }
      this.error(message)
    }
  }

  private async handleCheck(
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: SqliteDatabase,
  ): Promise<void> {
    if (!isTrelloConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'TRELLO_NOT_CONFIGURED',
          'Trello is not configured. Run "prlt trello configure" to authenticate.',
          createMetadata('trello configure', flags),
        )
        return
      }
      this.log(colors.warning('Trello is not configured.'))
      this.log(colors.textMuted('Run "prlt trello configure" to authenticate.'))
      this.exit(1)
      return
    }

    const config = loadTrelloConfig(db)!
    try {
      const client = new TrelloClient(config.apiKey, config.apiToken)
      const member = await client.verify()

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          user: member.fullName,
          username: member.username,
          board: config.boardName ?? config.boardId ?? null,
        }, createMetadata('trello configure', flags))
        return
      }

      this.log(colors.success('Trello connection is active'))
      this.log(colors.textMuted(`  User: ${member.fullName} (@${member.username})`))
      if (config.boardName) {
        this.log(colors.textMuted(`  Board: ${config.boardName}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'TRELLO_AUTH_INVALID',
          `Stored Trello credentials are invalid or expired: ${message}`,
          createMetadata('trello configure', flags),
        )
        return
      }
      this.log(colors.error('Stored Trello credentials are invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt trello configure --force" to re-authenticate.'))
      this.exit(1)
    }
  }
}
