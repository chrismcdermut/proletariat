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
  isTrelloConfigured,
  loadTrelloConfig,
  saveTrelloApiKey,
  saveTrelloApiToken,
  saveTrelloBoard,
  clearTrelloConfig,
  getTrelloApiKey,
  getTrelloApiToken,
  TrelloClient,
} from '../../lib/trello/index.js'

async function verifyTrelloCredentials(
  apiKey: string,
  apiToken: string,
): Promise<{ fullName: string; username: string }> {
  const client = new TrelloClient(apiKey, apiToken)
  const member = await client.verify()
  return {
    fullName: member.fullName,
    username: member.username,
  }
}

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
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TrelloConfigure)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearTrelloConfig(db)
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
        const info = await verifyTrelloCredentials(existingConfig.apiKey, existingConfig.apiToken)

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: info.fullName,
            username: info.username,
            boardId: existingConfig.boardId ?? null,
            boardName: existingConfig.boardName ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('trello configure', flags))
          return
        }
        this.log(colors.success('Already connected to Trello'))
        this.log(colors.textMuted(`  User: ${info.fullName} (@${info.username})`))
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

    // Try environment variables first
    let apiKey = getTrelloApiKey(db)
    let apiToken = getTrelloApiToken(db)

    if (!apiKey || !apiToken) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_CREDENTIALS_REQUIRED',
          'Trello API key and token required. Set TRELLO_API_KEY and TRELLO_API_TOKEN environment variables, or run interactively.',
          createMetadata('trello configure', flags),
        )
        this.exit(1)
      }

      this.log('')
      this.log(colors.primary('Trello Authentication'))
      this.log('')
      this.log('Get your API key and token at:')
      this.log(colors.textSecondary('  https://trello.com/power-ups/admin'))
      this.log('')

      if (!apiKey) {
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
    }

    // Verify the credentials
    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying credentials...'))
    }

    try {
      const info = await verifyTrelloCredentials(apiKey!, apiToken!)

      // Save credentials
      saveTrelloApiKey(db, apiKey!)
      saveTrelloApiToken(db, apiToken!)

      if (!jsonMode) {
        this.log(colors.success('Connected to Trello'))
        this.log(colors.textMuted(`  Signed in as ${info.fullName} (@${info.username})`))
      }

      // Prompt for default board selection
      if (!jsonMode) {
        const client = new TrelloClient(apiKey!, apiToken!)
        const boards = await client.listBoards()

        if (boards.length > 0) {
          const choices = [
            ...boards.map(b => ({ name: b.name, value: b.id })),
            { name: 'Skip (no default board)', value: '' },
          ]
          const message = 'Select a default board:'

          const { boardId } = await inquirer.prompt([{
            type: 'list',
            name: 'boardId',
            message,
            choices,
          }])

          if (boardId) {
            const board = boards.find(b => b.id === boardId)
            if (board) {
              saveTrelloBoard(db, board.id, board.name)
              this.log(colors.textMuted(`  Default board: ${board.name}`))
            }
          }
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: info.fullName,
          username: info.username,
        }, createMetadata('trello configure', flags))
        return
      }

      this.log('')
      this.log(colors.success('Trello integration configured!'))
      this.log(colors.textMuted('  Run "prlt work trello" to pull cards and spawn agents'))
      this.log(colors.textMuted('  Run "prlt work spawn --from trello" to use as default source'))
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('TRELLO_CONNECT_FAILED', message, createMetadata('trello configure', flags))
        this.exit(1)
      }
      this.error(message)
    }
  }

  private async handleCheck(
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
  ): Promise<void> {
    if (!isTrelloConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'TRELLO_NOT_CONFIGURED',
          'Trello is not configured. Run "prlt trello configure" to authenticate.',
          createMetadata('trello configure', flags),
        )
        this.exit(1)
      }
      this.log(colors.warning('Trello is not configured.'))
      this.log(colors.textMuted('Run "prlt trello configure" to authenticate.'))
      this.exit(1)
      return
    }

    const config = loadTrelloConfig(db)!
    try {
      const info = await verifyTrelloCredentials(config.apiKey, config.apiToken)

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          user: info.fullName,
          username: info.username,
          boardId: config.boardId ?? null,
          boardName: config.boardName ?? null,
        }, createMetadata('trello configure', flags))
        return
      }

      this.log(colors.success('Trello connection is active'))
      this.log(colors.textMuted(`  User: ${info.fullName} (@${info.username})`))
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
        this.exit(1)
      }
      this.log(colors.error('Stored Trello credentials are invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt trello configure --force" to re-authenticate.'))
      this.exit(1)
    }
  }
}
