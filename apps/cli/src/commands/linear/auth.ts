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
  LinearClient,
  loadLinearConfig,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
  clearLinearConfig,
  getLinearApiKey,
} from '../../lib/linear/index.js'

export default class LinearAuth extends PMOCommand {
  static description = 'Authenticate with Linear (alias for "prlt linear connect")'

  static hidden = true

  static examples = [
    '<%= config.bin %> linear connect',
    '<%= config.bin %> linear connect --check',
    '<%= config.bin %> linear connect --force',
    'LINEAR_API_KEY=lin_api_... <%= config.bin %> linear connect',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Linear credentials exist (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Linear credentials',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LinearAuth)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearLinearConfig(db)
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Linear credentials removed.',
        }, createMetadata('linear auth', flags))
        return
      }
      this.log(colors.success('Linear credentials removed.'))
      return
    }

    // Handle --check
    if (flags.check) {
      const config = loadLinearConfig(db)
      if (config) {
        // Try to verify the connection
        try {
          const client = new LinearClient(config.apiKey)
          const info = await client.verify()

          if (jsonMode) {
            outputSuccessAsJson({
              authenticated: true,
              organization: info.organizationName,
              user: info.userName,
              email: info.email,
              defaultTeam: config.defaultTeamKey ?? null,
            }, createMetadata('linear auth', flags))
            return
          }
          this.log(colors.success('Linear connection is active'))
          this.log(colors.textMuted(`  Organization: ${info.organizationName}`))
          this.log(colors.textMuted(`  User: ${info.userName} (${info.email})`))
          if (config.defaultTeamKey) {
            this.log(colors.textMuted(`  Default team: ${config.defaultTeamKey}`))
          }
        } catch (_error) {
          if (jsonMode) {
            outputErrorAsJson('LINEAR_AUTH_INVALID', 'Stored Linear API key is invalid or expired.', createMetadata('linear auth', flags))
            return
          }
          this.log(colors.error('Stored Linear API key is invalid or expired.'))
          this.log(colors.textMuted('Run "prlt linear auth --force" to re-authenticate.'))
          this.exit(1)
        }
      } else {
        if (jsonMode) {
          outputErrorAsJson('LINEAR_NOT_CONFIGURED', 'Linear is not configured. Run "prlt linear auth" to authenticate.', createMetadata('linear auth', flags))
          return
        }
        this.log(colors.warning('Linear is not configured.'))
        this.log(colors.textMuted('Run "prlt linear auth" to authenticate.'))
        this.exit(1)
      }
      return
    }

    // Check for existing config
    const existingConfig = loadLinearConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new LinearClient(existingConfig.apiKey)
        const info = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            organization: info.organizationName,
            user: info.userName,
            message: 'Already authenticated. Use --force to re-authenticate.',
          }, createMetadata('linear auth', flags))
          return
        }
        this.log(colors.success('Already connected to Linear'))
        this.log(colors.textMuted(`  Organization: ${info.organizationName}`))
        this.log(colors.textMuted(`  User: ${info.userName}`))
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored key is bad, proceed with re-auth
      }
    }

    // Try environment variable first
    const envKey = getLinearApiKey(db)
    let apiKey = envKey

    if (!apiKey) {
      // Prompt for API key
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'Linear API key required. Configure a Linear provider source, set PRLT_LINEAR_API_KEY, or run interactively.',
          createMetadata('linear auth', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('Linear Authentication'))
      this.log('')
      this.log('Create a personal API key at:')
      this.log(colors.textSecondary('  https://linear.app/settings/api'))
      this.log('')

      const { inputKey } = await inquirer.prompt([{
        type: 'password',
        name: 'inputKey',
        message: 'Enter your Linear API key:',
        mask: '*',
        validate: (input: string) => {
          if (!input.trim()) return 'API key is required'
          if (!input.startsWith('lin_api_')) return 'Linear API keys start with "lin_api_"'
          return true
        },
      }])
      apiKey = inputKey
    }

    // Verify the API key
    this.log('')
    this.log(colors.textMuted('Verifying API key...'))

    let client: LinearClient
    try {
      client = new LinearClient(apiKey!)
      const info = await client.verify()

      // Save API key and org name
      saveLinearApiKey(db, apiKey!)
      saveLinearOrganization(db, info.organizationName)

      if (jsonMode) {
        // Don't prompt for team in JSON mode, just save the key
        outputSuccessAsJson({
          authenticated: true,
          organization: info.organizationName,
          user: info.userName,
          email: info.email,
        }, createMetadata('linear auth', flags))
        return
      }

      this.log(colors.success(`Connected to ${info.organizationName}`))
      this.log(colors.textMuted(`  Signed in as ${info.userName} (${info.email})`))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('LINEAR_AUTH_FAILED', `Authentication failed: ${error instanceof Error ? error.message : String(error)}`, createMetadata('linear auth', flags))
        return
      }
      this.error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Prompt for default team selection
    this.log('')
    const teams = await client!.listTeams()

    if (teams.length === 0) {
      this.log(colors.warning('No teams found in your Linear workspace.'))
      return
    }

    if (teams.length === 1) {
      // Auto-select the only team
      saveLinearDefaultTeam(db, teams[0].id, teams[0].key)
      this.log(colors.textMuted(`  Default team set to: ${teams[0].name} (${teams[0].key})`))
    } else {
      const teamChoices = teams.map((t) => ({
        name: `${t.name} (${t.key})`,
        value: t.id,
      }))

      const { selectedTeamId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTeamId',
        message: 'Select your default team:',
        choices: teamChoices,
      }])

      const selectedTeam = teams.find((t) => t.id === selectedTeamId)!
      saveLinearDefaultTeam(db, selectedTeam.id, selectedTeam.key)
      this.log(colors.textMuted(`  Default team set to: ${selectedTeam.name} (${selectedTeam.key})`))
    }

    this.log('')
    this.log(colors.success('Linear integration configured!'))
    this.log(colors.textMuted('  Run "prlt linear import" to pull issues into PMO'))
    this.log(colors.textMuted('  Run "prlt work spawn --from-linear" to pull and spawn agents'))
  }
}
