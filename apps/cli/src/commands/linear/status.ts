import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  LinearClient,
  isLinearConfigured,
  loadLinearConfig,
} from '../../lib/linear/index.js'
import { LinearMapper } from '../../lib/linear/mapper.js'

export default class LinearStatus extends PMOCommand {
  static description = 'Validate Linear token, team access, and show integration health'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LinearStatus)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isLinearConfigured(db)) {
      if (jsonMode) {
        outputSuccessAsJson({
          configured: false,
          connected: false,
          message: 'Linear is not configured. Run "prlt linear connect" to set up.',
        }, createMetadata('linear status', flags))
        return
      }
      this.log(colors.warning('Linear is not configured'))
      this.log(colors.textMuted('Run "prlt linear connect" to connect your Linear workspace.'))
      return
    }

    const config = loadLinearConfig(db)!

    // Verify connection (token health check)
    let connectionInfo: { organizationName: string; userName: string; email: string } | null = null
    let connectionError: string | null = null

    try {
      const client = new LinearClient(config.apiKey)
      connectionInfo = await client.verify()
    } catch (error) {
      connectionError = error instanceof Error ? error.message : String(error)
    }

    // Validate team access
    let teamValid: boolean | null = null
    let teamError: string | null = null
    if (connectionInfo && config.defaultTeamId) {
      try {
        const client = new LinearClient(config.apiKey)
        const teams = await client.listTeams()
        teamValid = teams.some((t) => t.id === config.defaultTeamId)
        if (!teamValid) {
          teamError = `Default team "${config.defaultTeamKey}" is no longer accessible. Run "prlt linear connect --force" to reconfigure.`
        }
      } catch (error) {
        teamValid = false
        teamError = `Failed to validate team access: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // Count mapped issues
    const mapper = new LinearMapper(db)
    const mappings = mapper.listMappings()

    if (jsonMode) {
      outputSuccessAsJson({
        configured: true,
        connected: connectionInfo !== null,
        organization: connectionInfo?.organizationName ?? config.organizationName ?? null,
        user: connectionInfo?.userName ?? null,
        email: connectionInfo?.email ?? null,
        defaultTeam: config.defaultTeamKey ?? null,
        teamValid,
        teamError,
        mappedIssues: mappings.length,
        error: connectionError,
      }, createMetadata('linear status', flags))
      return
    }

    this.log(colors.primary('Linear Integration Status'))
    this.log('')

    if (connectionInfo) {
      this.log(`  ${colors.success('Connected')}`)
      this.log(colors.textMuted(`  Organization: ${connectionInfo.organizationName}`))
      this.log(colors.textMuted(`  User: ${connectionInfo.userName} (${connectionInfo.email})`))
    } else {
      this.log(`  ${colors.error('Connection failed')}`)
      if (connectionError) {
        this.log(colors.textMuted(`  Error: ${connectionError}`))
      }
      this.log(colors.textMuted('  Run "prlt linear connect --force" to re-authenticate.'))
    }

    if (config.defaultTeamKey) {
      if (teamValid === true) {
        this.log(colors.textMuted(`  Default team: ${config.defaultTeamKey}`))
      } else if (teamValid === false) {
        this.log(colors.warning(`  Default team: ${config.defaultTeamKey} (inaccessible)`))
        if (teamError) {
          this.log(colors.textMuted(`  ${teamError}`))
        }
      } else {
        this.log(colors.textMuted(`  Default team: ${config.defaultTeamKey}`))
      }
    } else if (connectionInfo) {
      this.log(colors.warning('  No default team configured'))
      this.log(colors.textMuted('  Run "prlt linear connect --force --team <KEY>" to set one.'))
    }

    this.log('')
    this.log(colors.textMuted(`  Mapped issues: ${mappings.length}`))

    if (mappings.length > 0) {
      const recent = mappings.slice(0, 5)
      this.log('')
      this.log(colors.textMuted('  Recent mappings:'))
      for (const m of recent) {
        this.log(colors.textMuted(`    ${m.linearIdentifier} → ${m.pmoTicketId}`))
      }
      if (mappings.length > 5) {
        this.log(colors.textMuted(`    ... and ${mappings.length - 5} more`))
      }
    }
  }
}
