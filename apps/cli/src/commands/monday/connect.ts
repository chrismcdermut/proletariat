import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { FlagResolver } from '../../lib/flags/index.js'
import {
  MondayClient,
  isMondayConfigured,
  loadMondayConfig,
  saveMondayApiToken,
  saveMondayBoard,
  saveMondayAccountName,
  clearMondayConfig,
  getMondayApiToken,
  getMondayBoardId,
} from '../../lib/monday/index.js'

export default class MondayConnect extends PMOCommand {
  static description = 'Connect PRLT to Monday.com and store workspace credentials'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --board 1234567890',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --disconnect',
  ]

  static flags = {
    ...pmoBaseFlags,
    board: Flags.string({
      description: 'Monday board ID to sync tickets to',
    }),
    check: Flags.boolean({
      description: 'Only check if Monday configuration is valid',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if already configured',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Monday credentials',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(MondayConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (flags.disconnect) {
      clearMondayConfig(db)
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Monday configuration removed.',
        }, createMetadata('monday connect', flags))
        return
      }

      this.log(colors.success('Monday configuration removed.'))
      return
    }

    if (flags.check) {
      await this.checkConnection(flags, jsonMode)
      return
    }

    const existingConfig = loadMondayConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new MondayClient(existingConfig.apiToken)
        const info = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            account: info.accountName,
            user: info.userName,
            boardId: existingConfig.boardId ?? null,
            boardName: existingConfig.boardName ?? null,
            message: 'Already authenticated. Use --force to re-authenticate.',
          }, createMetadata('monday connect', flags))
          return
        }

        this.log(colors.success('Already connected to Monday.com'))
        this.log(colors.textMuted(`  Account: ${info.accountName}`))
        this.log(colors.textMuted(`  User: ${info.userName}`))
        if (existingConfig.boardId) {
          this.log(colors.textMuted(`  Board: ${existingConfig.boardName ?? 'Unknown'} (${existingConfig.boardId})`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored token is invalid, proceed with re-authentication.
      }
    }

    let apiToken = getMondayApiToken(db)
    if (!apiToken) {
      const resolver = new FlagResolver({
        commandName: 'monday connect',
        baseCommand: 'prlt monday connect',
        jsonMode,
        flags,
      })

      resolver.addPrompt({
        flagName: 'token',
        type: 'input',
        message: 'Enter your Monday API token:',
        validate: (value) => String(value).trim().length > 0 || 'API token is required',
        context: {
          hint: 'Set MONDAY_API_TOKEN or PRLT_MONDAY_API_TOKEN environment variable, or provide the token interactively.',
        },
      })

      const resolved = await resolver.resolve()
      apiToken = resolved.token as string
    }

    if (!apiToken) {
      this.error('Monday API token is required.')
    }
    const client = new MondayClient(apiToken)

    let boardId = flags.board ?? getMondayBoardId(db)
    if (!boardId) {
      const resolver = new FlagResolver({
        commandName: 'monday connect',
        baseCommand: 'prlt monday connect',
        jsonMode,
        flags,
      })

      resolver.addPrompt({
        flagName: 'board',
        type: 'input',
        message: 'Enter Monday board ID for ticket sync:',
        validate: (value) => String(value).trim().length > 0 || 'Board ID is required',
      })

      const resolved = await resolver.resolve()
      boardId = resolved.board as string
    }

    try {
      const info = await client.verify()
      saveMondayApiToken(db, apiToken)
      saveMondayAccountName(db, info.accountName)

      let boardName: string | null = null
      if (boardId) {
        const board = await client.getBoard(boardId)
        if (!board) {
          if (jsonMode) {
            outputErrorAsJson('BOARD_NOT_FOUND', `Monday board ${boardId} was not found or is inaccessible.`, createMetadata('monday connect', flags))
            this.exit(1)
          }
          this.error(`Monday board ${boardId} was not found or is inaccessible.`)
        }

        boardName = board.name
        saveMondayBoard(db, board.id, board.name)
        boardId = board.id
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          account: info.accountName,
          user: info.userName,
          email: info.email ?? null,
          boardId: boardId ?? null,
          boardName,
        }, createMetadata('monday connect', flags))
        return
      }

      this.log(colors.success(`Connected to Monday account: ${info.accountName}`))
      this.log(colors.textMuted(`  Signed in as ${info.userName}${info.email ? ` (${info.email})` : ''}`))
      if (boardId) {
        this.log(colors.textMuted(`  Default board: ${boardName ?? 'Unknown'} (${boardId})`))
      } else {
        this.log(colors.warning('No board selected yet.'))
        this.log(colors.textMuted('  Run "prlt monday connect --board <board-id>" to set one.'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('MONDAY_AUTH_FAILED', `Authentication failed: ${message}`, createMetadata('monday connect', flags))
        this.exit(1)
      }
      this.error(`Authentication failed: ${message}`)
    }
  }

  private async checkConnection(flags: Record<string, unknown>, jsonMode: boolean): Promise<void> {
    const db = this.storage.getDatabase()

    if (!isMondayConfigured(db)) {
      if (jsonMode) {
        outputSuccessAsJson({
          configured: false,
          message: 'Monday is not configured. Run "prlt monday connect" first.',
        }, createMetadata('monday connect', flags))
        return
      }

      this.log(colors.warning('Monday is not configured.'))
      this.log(colors.textMuted('Run "prlt monday connect" first.'))
      this.exit(1)
    }

    const config = loadMondayConfig(db)!

    try {
      const client = new MondayClient(config.apiToken)
      const info = await client.verify()

      let board: { id: string; name: string } | null = null
      if (config.boardId) {
        const fetched = await client.getBoard(config.boardId)
        board = fetched ? { id: fetched.id, name: fetched.name } : null
      }

      if (jsonMode) {
        outputSuccessAsJson({
          configured: true,
          connected: true,
          account: info.accountName,
          user: info.userName,
          boardId: config.boardId ?? null,
          boardName: board?.name ?? config.boardName ?? null,
        }, createMetadata('monday connect', flags))
        return
      }

      this.log(colors.success('Monday connection is active'))
      this.log(colors.textMuted(`  Account: ${info.accountName}`))
      this.log(colors.textMuted(`  User: ${info.userName}`))
      if (config.boardId) {
        this.log(colors.textMuted(`  Board: ${board?.name ?? config.boardName ?? 'Unknown'} (${config.boardId})`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('MONDAY_AUTH_INVALID', `Stored Monday token is invalid or expired: ${message}`, createMetadata('monday connect', flags))
        this.exit(1)
      }

      this.log(colors.error('Stored Monday token is invalid or expired.'))
      this.log(colors.textMuted('Run "prlt monday connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }
}
