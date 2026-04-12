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
  LinearClient,
  isLinearConfigured,
  loadLinearConfig,
  saveLinearApiKey,
  saveLinearDefaultTeam,
  saveLinearOrganization,
  clearLinearConfig,
  getLinearApiKey,
} from '../../lib/linear/index.js'
import { upsertProviderSource, removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'
import { autoMapIntents, formatMappingTable } from '../../lib/providers/auto-mapper.js'
import { TransitionMapStore } from '../../lib/providers/transition-map.js'

export default class LinearConnect extends PMOCommand {
  static description = 'Connect to Linear workspace and configure authentication'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --disconnect',
    '<%= config.bin %> <%= command.id %> --team ENG',
    'LINEAR_API_KEY=lin_api_... <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Linear credentials are valid (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Linear credentials and configuration',
      default: false,
    }),
    team: Flags.string({
      description: 'Default team key (e.g., "ENG") for non-interactive setup',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LinearConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Handle --disconnect
    if (flags.disconnect) {
      clearLinearConfig(db)
      removeProviderSourcesByProvider(db, 'linear')
      if (jsonMode) {
        outputSuccessAsJson({
          disconnected: true,
          message: 'Linear credentials and configuration removed.',
        }, createMetadata('linear connect', flags))
        return
      }
      this.log(colors.success('Linear credentials and configuration removed.'))
      return
    }

    // Handle --check (health check)
    if (flags.check) {
      return this.handleCheck(flags, jsonMode, db)
    }

    // Check for existing config
    const existingConfig = loadLinearConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new LinearClient(existingConfig.apiKey)
        const info = await client.verify()

        // If --team flag was provided, update the default team without re-auth
        if (flags.team) {
          await this.handleTeamSelection(client, flags, jsonMode, db, info)
          return
        }

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            organization: info.organizationName,
            user: info.userName,
            email: info.email,
            defaultTeam: existingConfig.defaultTeamKey ?? null,
            message: 'Already connected. Use --force to re-authenticate.',
          }, createMetadata('linear connect', flags))
          return
        }
        this.log(colors.success('Already connected to Linear'))
        this.log(colors.textMuted(`  Organization: ${info.organizationName}`))
        this.log(colors.textMuted(`  User: ${info.userName} (${info.email})`))
        if (existingConfig.defaultTeamKey) {
          this.log(colors.textMuted(`  Default team: ${existingConfig.defaultTeamKey}`))
        }
        this.log('')
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Stored key is bad, proceed with re-auth
      }
    }

    // Try environment variable first
    let apiKey = getLinearApiKey(db)

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'Linear API key required. Configure a Linear provider source, set PRLT_LINEAR_API_KEY, or run interactively.',
          createMetadata('linear connect', flags),
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
    if (!jsonMode) {
      this.log('')
      this.log(colors.textMuted('Verifying API key...'))
    }

    let client: LinearClient
    try {
      client = new LinearClient(apiKey!)
      const info = await client.verify()

      // Save API key and org name
      saveLinearApiKey(db, apiKey!)
      saveLinearOrganization(db, info.organizationName)

      if (!jsonMode) {
        this.log(colors.success(`Connected to ${info.organizationName}`))
        this.log(colors.textMuted(`  Signed in as ${info.userName} (${info.email})`))
      }

      // Handle team selection
      await this.handleTeamSelection(client, flags, jsonMode, db, info)
    } catch (error) {
      const message = `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      if (jsonMode) {
        outputErrorAsJson('LINEAR_CONNECT_FAILED', message, createMetadata('linear connect', flags))
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
    if (!isLinearConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson(
          'LINEAR_NOT_CONFIGURED',
          'Linear is not configured. Run "prlt linear connect" to authenticate.',
          createMetadata('linear connect', flags),
        )
        return
      }
      this.log(colors.warning('Linear is not configured.'))
      this.log(colors.textMuted('Run "prlt linear connect" to authenticate.'))
      this.exit(1)
      return
    }

    const config = loadLinearConfig(db)!
    try {
      const client = new LinearClient(config.apiKey)
      const info = await client.verify()

      // Validate team access if a default team is configured
      let teamValid = false
      let teamError: string | null = null
      if (config.defaultTeamId) {
        try {
          const teams = await client.listTeams()
          teamValid = teams.some((t) => t.id === config.defaultTeamId)
          if (!teamValid) {
            teamError = `Default team "${config.defaultTeamKey}" is no longer accessible.`
          }
        } catch (error) {
          teamError = `Failed to validate team access: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          connected: true,
          organization: info.organizationName,
          user: info.userName,
          email: info.email,
          defaultTeam: config.defaultTeamKey ?? null,
          teamValid: config.defaultTeamId ? teamValid : null,
          teamError,
        }, createMetadata('linear connect', flags))
        return
      }

      this.log(colors.success('Linear connection is active'))
      this.log(colors.textMuted(`  Organization: ${info.organizationName}`))
      this.log(colors.textMuted(`  User: ${info.userName} (${info.email})`))
      if (config.defaultTeamKey) {
        if (teamValid) {
          this.log(colors.textMuted(`  Default team: ${config.defaultTeamKey}`))
        } else {
          this.log(colors.warning(`  Default team: ${config.defaultTeamKey} (${teamError ?? 'inaccessible'})`))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'LINEAR_AUTH_INVALID',
          `Stored Linear API key is invalid or expired: ${message}`,
          createMetadata('linear connect', flags),
        )
        return
      }
      this.log(colors.error('Stored Linear API key is invalid or expired.'))
      this.log(colors.textMuted(`  Error: ${message}`))
      this.log(colors.textMuted('Run "prlt linear connect --force" to re-authenticate.'))
      this.exit(1)
    }
  }

  private async handleTeamSelection(
    client: LinearClient,
    flags: Record<string, unknown>,
    jsonMode: boolean,
    db: import('better-sqlite3').Database,
    info: { organizationName: string; userName: string; email: string },
  ): Promise<void> {
    const teams = await client.listTeams()

    if (teams.length === 0) {
      // Register provider source even without a team
      upsertProviderSource(db, {
        id: 'linear',
        provider: 'linear',
        apiKeyRef: 'linear.api_key',
        teamProjectId: 'default',
        prefix: 'LIN-',
        label: info.organizationName,
      })

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          organization: info.organizationName,
          user: info.userName,
          email: info.email,
          defaultTeam: null,
          message: 'No teams found in your Linear workspace.',
        }, createMetadata('linear connect', flags))
        return
      }
      this.log(colors.warning('No teams found in your Linear workspace.'))
      this.log('')
      this.log(colors.success('Linear integration configured!'))
      return
    }

    // If --team flag was provided, resolve it
    if (flags.team) {
      const teamKey = (flags.team as string).toUpperCase()
      const matched = teams.find((t) => t.key.toUpperCase() === teamKey)
      if (!matched) {
        const available = teams.map((t) => t.key).join(', ')
        const message = `Team "${flags.team}" not found. Available teams: ${available}`
        if (jsonMode) {
          outputErrorAsJson('TEAM_NOT_FOUND', message, createMetadata('linear connect', flags))
          return
        }
        this.error(message)
      }
      saveLinearDefaultTeam(db, matched!.id, matched!.key)
      upsertProviderSource(db, {
        id: 'linear',
        provider: 'linear',
        apiKeyRef: 'linear.api_key',
        teamProjectId: matched!.key,
        prefix: `${matched!.key}-`,
        label: matched!.name,
      })

      // Auto-map board states to transition intents
      await this.autoMapBoardStates(client, matched!.id, db, jsonMode)

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          organization: info.organizationName,
          user: info.userName,
          email: info.email,
          defaultTeam: matched!.key,
        }, createMetadata('linear connect', flags))
        return
      }
      this.log(colors.textMuted(`  Default team set to: ${matched!.name} (${matched!.key})`))
      this.log('')
      this.log(colors.success('Linear integration configured!'))
      this.log(colors.textMuted('  Run "prlt linear import" to pull issues into PMO'))
      return
    }

    // JSON mode without --team: output success with available teams
    if (jsonMode) {
      const teamChoices = teams.map((t) => ({
        name: `${t.name} (${t.key})`,
        value: t.key,
      }))
      const message = 'Select a default team:'
      outputPromptAsJson(
        buildPromptConfig('list', 'team', message, teamChoices),
        createMetadata('linear connect', flags),
      )
      return
    }

    // Interactive team selection
    this.log('')
    let selectedTeamKey: string
    let selectedTeamName: string
    if (teams.length === 1) {
      saveLinearDefaultTeam(db, teams[0].id, teams[0].key)
      selectedTeamKey = teams[0].key
      selectedTeamName = teams[0].name
      this.log(colors.textMuted(`  Default team set to: ${teams[0].name} (${teams[0].key})`))
    } else {
      const teamChoices = teams.map((t) => ({
        name: `${t.name} (${t.key})`,
        value: t.id,
      }))
      const message = 'Select your default team:'

      const { selectedTeamId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTeamId',
        message,
        choices: teamChoices,
      }])

      const selectedTeam = teams.find((t) => t.id === selectedTeamId)!
      saveLinearDefaultTeam(db, selectedTeam.id, selectedTeam.key)
      selectedTeamKey = selectedTeam.key
      selectedTeamName = selectedTeam.name
      this.log(colors.textMuted(`  Default team set to: ${selectedTeam.name} (${selectedTeam.key})`))
    }

    // Register as provider source
    upsertProviderSource(db, {
      id: 'linear',
      provider: 'linear',
      apiKeyRef: 'linear.api_key',
      teamProjectId: selectedTeamKey,
      prefix: `${selectedTeamKey}-`,
      label: selectedTeamName,
    })

    // Auto-map board states to transition intents
    const selectedTeam = teams.find((t) => t.key === selectedTeamKey)
    if (selectedTeam) {
      await this.autoMapBoardStates(client, selectedTeam.id, db, jsonMode)
    }

    this.log('')
    this.log(colors.success('Linear integration configured!'))
    this.log(colors.textMuted('  Run "prlt linear import" to pull issues into PMO'))
    this.log(colors.textMuted('  Run "prlt work spawn --from-linear" to pull and spawn agents'))
  }

  /**
   * Pull board states from Linear, auto-guess intent mappings,
   * show to user for confirmation, and store in pmo_transition_map.
   */
  private async autoMapBoardStates(
    client: LinearClient,
    teamId: string,
    db: import('better-sqlite3').Database,
    jsonMode: boolean,
  ): Promise<void> {
    try {
      const states = await client.listStates(teamId)
      if (states.length === 0) return

      // Sort by position for display
      const sortedStates = [...states].sort((a, b) => a.position - b.position)

      // Auto-guess mappings using state types + name heuristics
      const mappings = autoMapIntents(
        sortedStates.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position })),
        'linear',
      )

      if (mappings.length === 0) return

      // Display the mapping table
      if (!jsonMode) {
        this.log('')
        this.log(colors.primary('Board State Mapping'))
        this.log('')
        const lines = formatMappingTable(
          mappings,
          sortedStates.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position })),
        )
        for (const line of lines) {
          this.log(colors.textMuted(`  ${line}`))
        }
        this.log('')
      }

      // In JSON mode, output the mappings for agent confirmation
      if (jsonMode) {
        // Store mappings automatically in JSON mode (agents can't confirm interactively)
        const store = new TransitionMapStore(db)
        for (const m of mappings) {
          store.upsertMapping({
            provider: 'linear',
            intent: m.intent,
            providerStateName: m.stateName,
            providerStateId: m.stateId,
          })
        }
        return
      }

      // Interactive: ask user to confirm or edit mappings
      const choices = [
        { name: 'Yes, save these mappings', value: 'accept' },
        { name: 'No, skip mapping for now', value: 'skip' },
      ]
      const message = 'Save these state mappings?'

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message,
        choices,
      }])

      if (action === 'accept') {
        const store = new TransitionMapStore(db)
        for (const m of mappings) {
          store.upsertMapping({
            provider: 'linear',
            intent: m.intent,
            providerStateName: m.stateName,
            providerStateId: m.stateId,
          })
        }
        this.log(colors.textMuted(`  Saved ${mappings.length} state mappings`))
      } else {
        this.log(colors.textMuted('  Skipped state mapping. You can configure later with "prlt config set state-map.<intent> <state-name>"'))
      }
    } catch (error) {
      // Non-fatal — don't block connect for mapping failures
      if (!jsonMode) {
        this.log(colors.textMuted(`  Could not auto-map board states: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }
}
