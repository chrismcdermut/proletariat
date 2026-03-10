import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  isTrelloConfigured,
  loadTrelloConfig,
  saveTrelloApiKey,
  saveTrelloApiToken,
  saveTrelloBoardId,
  clearTrelloConfig,
  getTrelloApiKey,
  getTrelloApiToken,
} from '../../lib/trello/index.js'

const TRELLO_API_BASE = 'https://api.trello.com/1'

interface TrelloMemberInfo {
  id: string
  fullName: string
  username: string
  email?: string
}

interface TrelloBoard {
  id: string
  name: string
  url: string
}

async function verifyTrelloCredentials(
  apiKey: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ userName: string; username: string; email: string }> {
  const authParams = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}`
  const response = await fetchImpl(`${TRELLO_API_BASE}/members/me?${authParams}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('Invalid or expired Trello API key/token.')
  }

  if (!response.ok) {
    throw new Error(`Trello API request failed with status ${response.status}.`)
  }

  const data = await response.json() as TrelloMemberInfo
  return {
    userName: data.fullName || 'Unknown',
    username: data.username || '',
    email: data.email || '',
  }
}

async function fetchBoards(
  apiKey: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TrelloBoard[]> {
  const authParams = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}`
  const response = await fetchImpl(`${TRELLO_API_BASE}/members/me/boards?${authParams}&filter=open`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })

  if (!response.ok) {
    return []
  }

  return await response.json() as TrelloBoard[]
}

export default class TrelloConnect extends PMOCommand {
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
    const { flags } = await this.parse(TrelloConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearTrelloConfig(db)
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Trello credentials and configuration removed.',
        }, createMetadata('trello connect', flags))
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
            user: info.userName,
            username: info.username,
            boardId: existingConfig.boardId ?? null,
            boardName: existingConfig.boardName ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('trello connect', flags))
          return
        }
        this.log(colors.success('Already connected to Trello'))
        this.log(colors.textMuted(`  User: ${info.userName} (@${info.username})`))
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
          createMetadata('trello connect', flags),
        )
        this.exit(1)
      }

      this.log('')
      this.log(colors.primary('Trello Authentication'))
      this.log('')
      this.log('Get your API key and generate a token at:')
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

    // Verify credentials
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
        this.log(colors.textMuted(`  Signed in as ${info.userName} (@${info.username})`))
      }

      // Prompt for board selection (interactive only)
      if (!jsonMode) {
        const boards = await fetchBoards(apiKey!, apiToken!)
        if (boards.length > 0) {
          this.log('')
          const choices = [
            ...boards.map(b => ({ name: b.name, value: b.id })),
            { name: 'Skip (no default board)', value: '' },
          ]
          const { boardId } = await inquirer.prompt([{
            type: 'list',
            name: 'boardId',
            message: 'Select a default board (optional):',
            choices,
          }])

          if (boardId) {
            const selectedBoard = boards.find(b => b.id === boardId)
            saveTrelloBoardId(db, boardId, selectedBoard?.name)
            this.log(colors.textMuted(`  Board: ${selectedBoard?.name || boardId}`))
          }
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: info.userName,
          username: info.username,
        }, createMetadata('trello connect', flags))
        return
      }

      this.log('')
      this.log(colors.success('Trello integration configured!'))
      this.log(colors.textMuted('  Run "prlt work trello" to pull cards and spawn agents'))
      this.log(colors.textMuted('  Run "prlt work spawn --from trello" to use as default source'))
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('TRELLO_CONNECT_FAILED', message, createMetadata('trello connect', flags))
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
          'Trello is not configured. Run "prlt trello connect" to authenticate.',
          createMetadata('trello connect', flags),
        )
        this.exit(1)
      }
      this.log(colors.warning('Trello is not configured.'))
      this.log(colors.textMuted('Run "prlt trello connect" to authenticate.'))
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
          user: info.userName,
          username: info.username,
          boardId: config.boardId ?? null,
          boardName: config.boardName ?? null,
        }, createMetadata('trello connect', flags))
        return
      }

      this.log(colors.success('Trello connection is active'))
      this.log(colors.textMuted(`  User: ${info.userName} (@${info.username})`))
      if (config.boardName) {
        this.log(colors.textMuted(`  Board: ${config.boardName}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'TRELLO_AUTH_INVALID',
          `Stored Trello credentials are invalid or expired: ${message}`,
          createMetadata('trello connect', flags),
        )
        this.exit(1)
      }
      this.log(colors.error('Stored Trello credentials are invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt trello connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }
}
