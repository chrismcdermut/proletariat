import { Flags } from '@oclif/core'
import * as path from 'node:path'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
  getTicketTmuxSession,
  killTmuxSession
} from '../../lib/agents/commands.js'
import { isDockerRunning, isGitHubTokenAvailable, isDevcontainerCliInstalled } from '../../lib/execution/runners.js'
import { PermissionMode } from '../../lib/execution/types.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { FlagResolver } from '../../lib/flags/index.js'

export default class WorkSpawn extends PMOCommand {
  static description = 'Spawn work for multiple tickets by column (batch mode)'

  static strict = false  // Allow multiple ticket ID args without defining them

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Interactive: All or Many',
    '<%= config.bin %> <%= command.id %> --all              # All tickets in selected column',
    '<%= config.bin %> <%= command.id %> --column Backlog   # All tickets in Backlog',
    '<%= config.bin %> <%= command.id %> --many             # Multi-select specific tickets',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002    # Spawn specific tickets by ID',
    '<%= config.bin %> <%= command.id %> --dry-run          # Preview without executing',
    '<%= config.bin %> <%= command.id %> --many --json      # Output ticket choices as JSON (for agents)',
    '<%= config.bin %> <%= command.id %> TKT-001 --action custom --message "Add unit tests"  # Custom prompt',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Spawn all tickets tickets in a column',
      default: false,
    }),
    many: Flags.boolean({
      description: 'Multi-select specific tickets to spawn',
      default: false,
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column name to spawn tickets from [required for non-interactive with --all]',
    }),
    strategy: Flags.string({
      char: 's',
      description: 'Agent selection strategy',
      options: ['round-robin', 'least-busy', 'random'],
      default: 'round-robin',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be spawned without executing',
      default: false,
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode for spawned agents (foreground not available for batch)',
      options: ['terminal', 'background'],
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if work already in progress',
      default: false,
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of tickets to spawn',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'per-ticket': Flags.boolean({
      description: 'Prompt for settings per ticket (default: batch mode with same settings for all)',
      default: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output mode (batch mode only)',
      options: ['interactive', 'print'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission prompts - danger mode (batch mode only)',
      default: false,
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready (batch mode only)',
      default: false,
    }),
    'no-pr': Flags.boolean({
      description: 'Do not create PR when work is ready (batch mode only)',
      default: false,
    }),
    action: Flags.string({
      description: 'Action to perform (e.g., groom, implement, review, custom). Prompts if not provided.',
    }),
    message: Flags.string({
      description: 'Custom prompt/message for the agent (use with --action custom)',
    }),
    session: Flags.string({
      description: 'Session manager inside container (tmux runs agent in tmux inside container)',
      options: ['tmux', 'direct'],
      default: 'tmux',
    }),
    focus: Flags.boolean({
      description: 'Bring terminal to foreground when opening new tabs (default: opens in background)',
      default: false,
    }),
    clone: Flags.boolean({
      description: 'Use independent git clone instead of worktree (more isolation, no real-time sync)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkSpawn)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work spawn', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Parse ticket IDs from args (everything after flags)
    const ticketIdArgs = argv as string[]

    // Try to infer project from ticket IDs if provided
    let projectId: string | undefined

    if (ticketIdArgs.length > 0) {
      // Look up tickets to get their project IDs
      const projectIds = new Set<string>()
      for (const ticketId of ticketIdArgs) {
        // eslint-disable-next-line no-await-in-loop
        const ticket = await this.storage.getTicket(ticketId)
        if (ticket?.projectId) {
          projectIds.add(ticket.projectId)
        }
      }

      if (projectIds.size === 1) {
        // All tickets from same project - use that project
        projectId = [...projectIds][0]
      } else if (projectIds.size > 1) {
        // Tickets from multiple projects - warn and require prompt
        this.warn('Tickets are from multiple projects. Please specify --project.')
      }
      // If size === 0, tickets not found - will be handled later in validation
    }

    // Only call requireProject() if we couldn't infer from tickets
    if (!projectId) {
      projectId = await this.requireProject({
        jsonMode: {
          flags,
          commandName: 'work spawn',
          baseCommand: 'prlt work spawn',
        },
      })
    }

    // Note: Docker check is handled by work:start command when spawning each ticket
    // This allows for the interactive devcontainer/host selection with retry loop

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)

    try {
      // Get board to list available columns
      const board = await this.storage.getBoard(projectId)
      const columnNames = board.columns.map(col => col.name)

      if (columnNames.length === 0) {
        db.close()
        return handleError('NO_COLUMNS', 'No columns found on the board.')
      }

      // Get all tickets (no assignee filter - show ALL tickets per ticket requirements)
      const allTickets = await this.storage.listTickets(projectId)

      if (allTickets.length === 0) {
        db.close()
        if (jsonMode) {
          outputErrorAsJson(
            'NO_TICKETS',
            'No tickets found to spawn.',
            createMetadata('work spawn', flags)
          )
          return
        }
        this.log(styles.muted('No tickets found to spawn.'))
        return
      }

      // Note: With ephemeral agents, we no longer need to check for available pre-registered agents
      // Agents are created on-demand when spawning

      // Determine spawn mode: All, Many, or Args (positional ticket IDs)
      let spawnMode: 'all' | 'many' | 'args' = 'all'

      if (ticketIdArgs.length > 0) {
        // Ticket IDs provided as positional args
        spawnMode = 'args'
      } else if (flags.all) {
        spawnMode = 'all'
      } else if (flags.many) {
        spawnMode = 'many'
      } else if (!flags.column) {
        // Use FlagResolver for mode selection prompt
        const modeResolver = new FlagResolver<{ mode?: string }>({
          commandName: 'work spawn',
          baseCommand: 'prlt work spawn',
          jsonMode,
          flags: {},
          context: { projectId },
        })

        modeResolver.addPrompt({
          flagName: 'mode',
          type: 'list',
          message: 'How would you like to spawn work?',
          choices: () => [
            { name: jsonMode ? 'All - Spawn all tickets in a column' : '📦 All    - Spawn all tickets tickets in a column', value: 'all' },
            { name: jsonMode ? 'Many - Select specific tickets to spawn' : '✅ Many   - Select specific tickets to spawn', value: 'many' },
          ],
        })

        const resolved = await modeResolver.resolve()
        // In JSON mode, resolve() exits after outputting prompt, so we never reach here
        // In interactive mode, we get the selected value
        spawnMode = resolved.mode as 'all' | 'many'
      }

      let ticketsToSpawn: typeof allTickets = []

      if (spawnMode === 'args') {
        // ARGS MODE: Spawn specific tickets by ID
        // Look up tickets by ID (don't filter by assignee - allow forcing assigned tickets)
        for (const ticketId of ticketIdArgs) {
          const ticket = allTickets.find(t => t.id.toLowerCase() === ticketId.toLowerCase())
          if (ticket) {
            ticketsToSpawn.push(ticket)
          } else {
            if (!jsonMode) {
              this.warn(`Ticket "${ticketId}" not found, skipping.`)
            }
          }
        }

        if (ticketsToSpawn.length === 0) {
          db.close()
          return handleError('NO_VALID_TICKETS', 'No valid tickets found from provided IDs.')
        }

        // In JSON mode with explicit tickets, output success
        if (jsonMode) {
          outputSuccessAsJson(
            {
              ticketsSelected: ticketsToSpawn.map(t => ({
                id: t.id,
                title: t.title,
                status: t.statusName,
              })),
              count: ticketsToSpawn.length,
            },
            createMetadata('work spawn', flags)
          )
          db.close()
          return
        }

        this.log('')
        this.log(styles.header(`🚀 Spawn: ${ticketsToSpawn.length} ticket(s)`))
        this.log(styles.muted(`Tickets: ${ticketsToSpawn.map(t => t.id).join(', ')}`))

      } else if (spawnMode === 'all') {
        // ALL MODE: Column picker, then spawn all tickets in that column
        let targetColumn = flags.column

        if (!targetColumn) {
          // Use FlagResolver for column selection
          const columnResolver = new FlagResolver<{ selectedColumn?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn --all',
            jsonMode,
            flags: {},
            context: { projectId },
          })

          columnResolver.addPrompt({
            flagName: 'selectedColumn',
            type: 'list',
            message: 'Select column to spawn all tickets tickets from:',
            choices: () => columnNames.map(name => {
              const count = allTickets.filter(t => t.statusName === name).length
              return {
                name: `${name} (${count} tickets)`,
                value: name,
              }
            }),
          })

          const resolved = await columnResolver.resolve()
          targetColumn = resolved.selectedColumn
        }

        // Verify column exists
        const matchedColumn = columnNames.find(
          c => c.toLowerCase() === targetColumn!.toLowerCase()
        )

        if (!matchedColumn) {
          db.close()
          return handleError(
            'COLUMN_NOT_FOUND',
            `Column "${targetColumn}" not found.\nAvailable columns: ${columnNames.join(', ')}`
          )
        }

        ticketsToSpawn = allTickets.filter(t => t.statusName === matchedColumn)

        if (ticketsToSpawn.length === 0) {
          db.close()
          if (jsonMode) {
            outputErrorAsJson(
              'NO_TICKETS_IN_COLUMN',
              `No tickets tickets in column "${matchedColumn}".`,
              createMetadata('work spawn', flags)
            )
            return
          }
          this.log(styles.muted(`No tickets tickets in column "${matchedColumn}".`))
          return
        }

        this.log('')
        this.log(styles.header(`🚀 Spawn All from: ${matchedColumn}`))

      } else {
        // MANY MODE: First pick column (or all), then multi-select tickets

        // In JSON mode with --many, output the ticket selection prompt directly
        // (skip column selection for simplicity - show all tickets)
        if (jsonMode) {
          // Use FlagResolver for ticket selection in JSON mode
          const ticketResolver = new FlagResolver<{ selectedTickets?: string[] }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
            context: { projectId },
          })

          ticketResolver.addPrompt({
            flagName: 'selectedTickets',
            type: 'checkbox',
            message: 'Select tickets to spawn (provide ticket IDs as positional args to execute):',
            choices: () => allTickets.map(ticket => {
              const priority = ticket.priority ? `[${ticket.priority}] ` : ''
              return {
                name: `${priority}${ticket.id} - ${ticket.title} (${ticket.statusName || 'No Status'})`,
                value: ticket.id,
              }
            }),
          })

          // In JSON mode, this exits after outputting prompt
          await ticketResolver.resolve()
          db.close()
          return
        }

        // Build column choices with counts - show ALL columns even if empty
        const columnChoices: Array<{ name: string; value: string }> = [
          { name: '🌐 All columns (select from anywhere)', value: '__ALL__' },
        ]
        for (const name of columnNames) {
          const count = allTickets.filter(t => t.statusName === name).length
          columnChoices.push({
            name: count > 0 ? `${name} (${count} tickets)` : `${name} (0)`,
            value: name,
          })
        }

        // Use FlagResolver for column selection (many mode)
        const manyColumnResolver = new FlagResolver<{ manyColumn?: string }>({
          commandName: 'work spawn',
          baseCommand: 'prlt work spawn --many',
          jsonMode,
          flags: {},
        })

        manyColumnResolver.addPrompt({
          flagName: 'manyColumn',
          type: 'list',
          message: 'Select from which column:',
          choices: () => columnChoices,
        })

        const manyColumnResult = await manyColumnResolver.resolve()
        const manyColumn = manyColumnResult.manyColumn

        // Filter tickets based on column selection
        const ticketsForSelection = manyColumn === '__ALL__'
          ? allTickets
          : allTickets.filter(t => t.statusName === manyColumn)

        if (ticketsForSelection.length === 0) {
          db.close()
          this.log(styles.muted('No tickets tickets in that column.'))
          return
        }

        // Group tickets by priority for display
        const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'None']
        const ticketsByPriority = new Map<string, typeof allTickets>()
        for (const priority of PRIORITY_ORDER) {
          ticketsByPriority.set(priority, [])
        }
        for (const ticket of ticketsForSelection) {
          const priority = ticket.priority || 'None'
          if (!ticketsByPriority.has(priority)) {
            ticketsByPriority.set(priority, [])
          }
          ticketsByPriority.get(priority)!.push(ticket)
        }

        // Build choices with priority separators
        const choices: Array<{ name: string; value: string } | inquirer.Separator> = []
        // Also build flat choices for JSON mode (without separators)
        const flatChoices: Array<{ name: string; value: string }> = []
        for (const priority of PRIORITY_ORDER) {
          const tickets = ticketsByPriority.get(priority) || []
          if (tickets.length === 0) continue
          choices.push(new inquirer.Separator(`── ${priority} (${tickets.length}) ──`))
          for (const ticket of tickets) {
            const statusBadge = ticket.statusName ? ` [${ticket.statusName}]` : ''
            const ticketChoice = {
              name: `[${priority}] ${ticket.id} - ${ticket.title}${statusBadge}`,
              value: ticket.id,
            }
            choices.push(ticketChoice)
            flatChoices.push(ticketChoice)
          }
        }

        // Use FlagResolver for ticket selection (checkbox)
        const ticketSelectResolver = new FlagResolver<{ selectedTicketIds?: string[] }>({
          commandName: 'work spawn',
          baseCommand: 'prlt work spawn',
          jsonMode,
          flags: {},
        })

        ticketSelectResolver.addPrompt({
          flagName: 'selectedTicketIds',
          type: 'checkbox',
          message: 'Select tickets to spawn (space to toggle, enter to confirm):',
          choices: () => flatChoices,
          validate: (input) => {
            if ((input as unknown as string[]).length === 0) {
              return 'Please select at least one ticket'
            }
            return true
          },
        })

        const ticketSelectResult = await ticketSelectResolver.resolve()
        const selectedTicketIds = ticketSelectResult.selectedTicketIds || []
        ticketsToSpawn = allTickets.filter(t => selectedTicketIds.includes(t.id))

        this.log('')
        this.log(styles.header(`🚀 Spawn Many: ${ticketsToSpawn.length} tickets`))
      }

      // Apply limit if specified
      if (flags.limit && flags.limit > 0) {
        ticketsToSpawn = ticketsToSpawn.slice(0, flags.limit)
      }

      this.log('')

      // Note: With ephemeral agents, we don't need to check availability
      // Each ticket will get its own ephemeral agent created on-demand

      // Check for tickets with existing tmux sessions (active work)
      const ticketsWithActiveSessions: Array<{ ticketId: string; sessionName: string; agent: string }> = []
      const ticketsToProcess: typeof ticketsToSpawn = []

      for (const ticket of ticketsToSpawn) {
        const session = getTicketTmuxSession(ticket.id)
        if (session) {
          ticketsWithActiveSessions.push({
            ticketId: ticket.id,
            sessionName: session.sessionName,
            agent: session.agent
          })
        } else {
          ticketsToProcess.push(ticket)
        }
      }

      // Handle tickets with active sessions
      if (ticketsWithActiveSessions.length > 0 && !jsonMode) {
        this.log(styles.warning(`Found ${ticketsWithActiveSessions.length} ticket(s) with active tmux sessions:`))
        for (const { ticketId, agent } of ticketsWithActiveSessions) {
          this.log(styles.muted(`  ${ticketId} → ${agent}`))
        }
        this.log('')

        const { sessionAction } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sessionAction',
            message: 'What would you like to do with these tickets?',
            choices: [
              { name: 'Skip them (only spawn tickets without active sessions)', value: 'skip' },
              { name: 'Kill sessions and respawn with new agents', value: 'kill' },
              { name: 'Cancel', value: 'cancel' },
            ],
          },
        ])

        if (sessionAction === 'cancel') {
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }

        if (sessionAction === 'kill') {
          // Kill existing sessions and add those tickets back to process list
          for (const { ticketId, sessionName } of ticketsWithActiveSessions) {
            killTmuxSession(sessionName)
            const ticket = ticketsToSpawn.find(t => t.id === ticketId)
            if (ticket) {
              ticketsToProcess.push(ticket)
            }
          }
          this.log(styles.success(`Killed ${ticketsWithActiveSessions.length} session(s)`))
        }
      }

      // Update ticketsToSpawn to only include tickets we'll process
      ticketsToSpawn = ticketsToProcess

      if (ticketsToSpawn.length === 0) {
        db.close()
        this.log(styles.muted('No tickets to spawn (all have active sessions).'))
        return
      }

      this.log(styles.muted(`Tickets: ${ticketsToSpawn.map(t => t.id).join(', ')}`))
      this.log(styles.muted(`Agents:  Ephemeral (unique per ticket)`))
      this.log('')

      // Note: Removed redundant confirmation - user already selected tickets
      // Use --dry-run to preview without executing

      // Dry run - just show what would happen
      if (flags['dry-run']) {
        db.close()
        this.log(styles.success(`Dry run complete: would spawn ${ticketsToSpawn.length} tickets with ephemeral agents`))
        return
      }

      // Batch mode settings - prompt once for all tickets
      let batchDisplay = flags.display
      let batchOutput = flags.output
      // Track permission mode - default to 'safe', check flag to determine if prompting needed
      let batchPermissionMode: PermissionMode = flags['skip-permissions'] ? 'danger' : 'safe'
      let batchCreatePr = flags['create-pr']
      let batchNoPr = flags['no-pr']
      let batchRunOnHost = flags['run-on-host']
      let batchAction = flags.action
      // Track custom message for custom action (needs to be outside the if block)
      let batchCustomMessage: string | undefined = flags.message
      // Track display mode separately for devcontainer (needs to be outside the if block)
      let batchDisplayMode: string | undefined

      // For ephemeral agents, we'll create devcontainers on-demand
      // Default to devcontainer support (can be overridden by --run-on-host)
      const hasDevcontainer = true // Ephemeral agents always get devcontainer config

      // Will be populated after action is selected/confirmed
      let selectedActionDetails: Awaited<ReturnType<typeof this.storage.getAction>> | null = null

      if (!flags['per-ticket']) {
        this.log(styles.header('Batch Settings (applies to all tickets)'))
        this.log('')

        // Prompt for action selection first (unless explicitly provided via --action flag)
        if (!flags.action) {
          // Get available actions from database
          const actions = await this.storage.listActions()
          const actionChoices = actions
            .filter(a => a.isBuiltin)
            .map(a => ({
              name: `${a.id.padEnd(12)} - ${a.description || a.name}`,
              value: a.id,
            }))

          // Add custom and adhoc options at the end
          actionChoices.push({
            name: 'custom       - Enter a custom prompt/instruction',
            value: '__custom__',
          })
          actionChoices.push({
            name: 'adhoc        - Unstructured exploration/debugging',
            value: '__adhoc__',
          })

          // Use FlagResolver for action selection with optional custom input
          const actionResolver = new FlagResolver<{ selectedAction?: string; customInput?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          actionResolver.addPrompt({
            flagName: 'selectedAction',
            type: 'list',
            message: 'What action should agents perform?',
            default: 'implement',
            choices: () => actionChoices,
          })

          actionResolver.addPrompt({
            flagName: 'customInput',
            type: 'input',
            message: 'Enter custom prompt for the agent:',
            when: (ctx) => ctx.flags.selectedAction === '__custom__',
            validate: (value) => (value as string).trim() ? true : 'Prompt cannot be empty',
          })

          const actionResult = await actionResolver.resolve()
          const selectedAction = actionResult.selectedAction

          if (selectedAction === '__custom__') {
            batchAction = 'custom'
            batchCustomMessage = (actionResult.customInput as string).trim()
          } else if (selectedAction === '__adhoc__') {
            batchAction = 'adhoc'
          } else {
            batchAction = selectedAction
          }
        } else if (flags.action === 'custom') {
          // Custom action specified via flag - require --message
          if (!flags.message) {
            db.close()
            return handleError('MISSING_MESSAGE', '--action custom requires --message flag with the custom prompt')
          }
          batchAction = 'custom'
          batchCustomMessage = flags.message
        } else if (flags.message && flags.action !== 'custom') {
          // --message provided without --action custom - warn user
          this.warn('--message flag is only used with --action custom, ignoring')
        }

        // Now fetch action details after selection is made
        if (batchAction === 'custom') {
          // Custom action - user provides their own prompt
          selectedActionDetails = {
            id: 'custom',
            name: 'Custom',
            description: 'Custom prompt/instruction',
            prompt: batchCustomMessage || '',
            modifiesCode: true, // Assume custom prompts may modify code
            defaultMoveToCategory: 'started',
            isBuiltin: false,
            createdAt: new Date(),
          }
        } else if (batchAction === 'adhoc') {
          // Adhoc is a synthetic action, not stored in database
          selectedActionDetails = {
            id: 'adhoc',
            name: 'Ad-hoc',
            description: 'Unstructured exploration and debugging',
            prompt: 'You are working on an ad-hoc session for exploration and debugging. Help the user with whatever they need.',
            modifiesCode: false,
            defaultMoveToCategory: 'started',
            isBuiltin: false,
            createdAt: new Date(),
          }
        } else {
          selectedActionDetails = await this.storage.getAction(batchAction || 'implement')
        }

        // Check if any explicit settings were provided via flags
        const hasExplicitSettings = flags.display || flags.output || flags['skip-permissions'] ||
          flags['create-pr'] || flags['no-pr'] || flags['run-on-host']

        // Offer to use default settings if no explicit flags provided
        if (!hasExplicitSettings) {
          const actionName = batchAction || 'implement'
          const modifiesCode = selectedActionDetails?.modifiesCode ?? true
          const defaultsDescription = modifiesCode
            ? 'devcontainer, terminal, interactive, safe permissions, create PRs'
            : 'devcontainer, terminal, interactive, safe permissions, no PRs'

          // Use FlagResolver for defaults choice
          const defaultsResolver = new FlagResolver<{ useDefaults?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          defaultsResolver.addPrompt({
            flagName: 'useDefaults',
            type: 'list',
            message: `Use default settings for "${actionName}"?`,
            default: 'yes',
            choices: () => [
              { name: `✓ Yes - Use defaults (${defaultsDescription})`, value: 'yes' },
              { name: '✗ No  - Configure each setting', value: 'no' },
            ],
          })

          const defaultsResult = await defaultsResolver.resolve()
          const useDefaults = defaultsResult.useDefaults === 'yes'

          if (useDefaults) {
            // Apply defaults
            if (hasDevcontainer) {
              batchDisplay = 'devcontainer'
              batchDisplayMode = 'terminal'
            } else {
              batchDisplay = 'terminal'
            }
            batchOutput = 'interactive'
            batchPermissionMode = 'safe'
            // For non-code-modifying actions, don't create PRs
            if (modifiesCode) {
              batchCreatePr = true
              batchNoPr = false
            } else {
              batchCreatePr = false
              batchNoPr = true
            }
            this.log('')
          }
        }

        // Prompt for environment (devcontainer vs host) if devcontainer available and not already set
        if (hasDevcontainer && !batchRunOnHost && !batchDisplay) {
          // Check devcontainer prerequisites upfront
          const dockerRunning = isDockerRunning()
          const devcontainerCliInstalled = isDevcontainerCliInstalled()
          const devcontainerReady = dockerRunning && devcontainerCliInstalled

          // Build missing requirements message for devcontainer option
          let devcontainerLabel = '🐳 devcontainer (sandboxed, recommended)'
          if (!devcontainerReady) {
            const missing: string[] = []
            if (!dockerRunning) missing.push('Docker')
            if (!devcontainerCliInstalled) missing.push('devcontainer CLI')
            devcontainerLabel = `🐳 devcontainer (requires: ${missing.join(', ')})`
          }

          const envChoices = [
            { name: devcontainerLabel, value: 'devcontainer', disabled: !devcontainerReady },
            { name: '💻 host (runs directly on your machine)', value: 'host' },
            { name: '✗  cancel', value: 'cancel' },
          ]

          // In JSON mode, use FlagResolver (outputs prompt and exits)
          if (jsonMode) {
            const envResolver = new FlagResolver<{ selectedEnvironment?: string }>({
              commandName: 'work spawn',
              baseCommand: 'prlt work spawn',
              jsonMode,
              flags: {},
            })

            envResolver.addPrompt({
              flagName: 'selectedEnvironment',
              type: 'list',
              message: 'Where should agents run?',
              default: devcontainerReady ? 'devcontainer' : 'host',
              choices: () => envChoices,
            })

            await envResolver.resolve()
            // FlagResolver exits in JSON mode, so we never reach here
            db.close()
            return
          }

          let environmentSelected = false
          while (!environmentSelected) {
            // eslint-disable-next-line no-await-in-loop -- Interactive loop with retry on Docker check
            const { selectedEnvironment } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedEnvironment',
                message: 'Where should agents run?',
                choices: envChoices,
                default: devcontainerReady ? 'devcontainer' : 'host',
              },
            ])

            if (selectedEnvironment === 'cancel') {
              db.close()
              this.log(styles.muted('Cancelled.'))
              return
            }

            if (selectedEnvironment === 'devcontainer') {
              // Double-check prerequisites (in case user retried after starting Docker)
              if (!isDockerRunning()) {
                this.log('')
                this.warn(
                  'Docker is not running.\n' +
                  'Docker is required for devcontainer execution.\n' +
                  'Please start Docker Desktop or select "host" to run directly on your machine.'
                )
                this.log('')
                continue
              }

              if (!isDevcontainerCliInstalled()) {
                this.log('')
                this.warn(
                  'devcontainer CLI is not installed.\n' +
                  'Install with: npm install -g @devcontainers/cli\n' +
                  'Or select "host" to run directly on your machine.'
                )
                this.log('')
                continue
              }

              // Check GitHub token is available for git push operations
              if (!isGitHubTokenAvailable()) {
                const tokenMessage = 'GitHub token not found. Git push may fail. Continue without token?'

                // Use FlagResolver for token action prompt
                const tokenResolver = new FlagResolver<{ tokenAction?: string }>({
                  commandName: 'work spawn',
                  baseCommand: 'prlt work spawn',
                  jsonMode,
                  flags: {},
                })

                tokenResolver.addPrompt({
                  flagName: 'tokenAction',
                  type: 'list',
                  message: tokenMessage,
                  default: 'continue',
                  choices: () => [
                    { name: 'Yes, continue anyway (git push may fail)', value: 'continue' },
                    { name: 'No, let me run gh auth login first', value: 'cancel' },
                    { name: 'Switch to host mode instead', value: 'host' },
                  ],
                })

                // In JSON mode, this will output prompt and exit
                // In interactive mode, show warning first
                if (!jsonMode) {
                  this.log('')
                  this.warn(
                    'GitHub token not found.\n' +
                    'Git push operations may fail inside containers.\n' +
                    'Run `gh auth login` to authenticate, or continue without token.'
                  )
                  this.log('')
                }

                // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
                const resolved = await tokenResolver.resolve()
                const tokenAction = resolved.tokenAction

                if (tokenAction === 'cancel') {
                  db.close()
                  this.log(styles.muted('Run `gh auth login` and try again.'))
                  return
                }

                if (tokenAction === 'host') {
                  batchRunOnHost = true
                  environmentSelected = true
                  continue
                }
                // tokenAction === 'continue' - fall through to devcontainer setup
              }

              batchDisplay = 'devcontainer'
              environmentSelected = true

              // For devcontainer, prompt for display mode
              // Simplified: tmux is always used inside container for session persistence
              // eslint-disable-next-line no-await-in-loop -- Follow-up prompt after selection
              const { selectedDisplay } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'selectedDisplay',
                  message: 'How should agent output be displayed?',
                  choices: [
                    { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
                    { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
                  ],
                  default: 'terminal',
                },
              ])
              batchDisplayMode = selectedDisplay

              // Always use tmux inside container for session persistence
              flags.session = 'tmux'
            } else {
              batchRunOnHost = true
              environmentSelected = true
            }
          }
        }

        // Prompt for display mode if not already set (for host mode without devcontainer)
        if (!batchDisplay) {
          // Use FlagResolver for display mode
          const displayResolver = new FlagResolver<{ selectedMode?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          displayResolver.addPrompt({
            flagName: 'selectedMode',
            type: 'list',
            message: 'How should agent output be displayed?',
            default: 'terminal',
            choices: () => [
              { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
              { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
            ],
          })

          const displayResult = await displayResolver.resolve()
          batchDisplay = displayResult.selectedMode
        }

        // Default to interactive output mode (streaming UI)
        // Can be overridden via --output flag if needed
        if (!batchOutput) {
          batchOutput = 'interactive'
        }

        // Prompt for permissions mode if not explicitly set via --skip-permissions flag
        if (!flags['skip-permissions']) {
          // Use FlagResolver for permission mode
          const permissionResolver = new FlagResolver<{ permissionMode?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          permissionResolver.addPrompt({
            flagName: 'permissionMode',
            type: 'list',
            message: 'Permission mode for Claude Code:',
            default: 'danger',
            choices: () => [
              { name: '⚠️  danger - Skip permission checks (faster, container provides isolation)', value: 'danger' },
              { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
            ],
          })

          const permissionResult = await permissionResolver.resolve()
          batchPermissionMode = permissionResult.permissionMode as PermissionMode
        }

        // Prompt for PR creation if not provided AND action modifies code
        // Skip this prompt entirely for non-code-modifying actions (like groom)
        const actionModifiesCode = selectedActionDetails?.modifiesCode ?? true
        if (!batchCreatePr && !batchNoPr) {
          if (actionModifiesCode) {
            // Use FlagResolver for PR choice
            const prResolver = new FlagResolver<{ prChoice?: string }>({
              commandName: 'work spawn',
              baseCommand: 'prlt work spawn',
              jsonMode,
              flags: {},
            })

            prResolver.addPrompt({
              flagName: 'prChoice',
              type: 'list',
              message: 'Create pull requests when work is ready?',
              default: 'yes',
              choices: () => [
                { name: '✓ Yes - Create PR for each ticket', value: 'yes' },
                { name: '✗ No  - Just move tickets to review', value: 'no' },
              ],
            })

            const prResult = await prResolver.resolve()
            batchCreatePr = prResult.prChoice === 'yes'
            batchNoPr = prResult.prChoice === 'no'
          } else {
            // Non-code-modifying action - no PR needed
            batchCreatePr = false
            batchNoPr = true
          }
        }

        this.log('')
      } else {
        // Per-ticket mode - still need to get action details if action flag was provided
        if (batchAction) {
          selectedActionDetails = await this.storage.getAction(batchAction)
        }
      }

      // Spawn each ticket - work:start will create ephemeral agents on-demand
      let successCount = 0
      let failCount = 0

      // Process sequentially for clear logging and resource management
      for (const ticket of ticketsToSpawn) {
        try {
          this.log(styles.muted(`Starting ${ticket.id} with ephemeral agent...`))

          // Build args for work:start
          // IMPORTANT: Pass --project to avoid re-prompting for project selection
          // Pass --ephemeral to signal work:start should create an ephemeral agent
          const startArgs: string[] = [ticket.id, '--project', projectId, '--ephemeral']

          // Pass clone flag if specified
          if (flags.clone) startArgs.push('--clone')

          if (flags['per-ticket']) {
            // Per-ticket mode: only pass display flag, let start prompt for the rest
            // batchDisplayMode is for devcontainer, batchDisplay is for host
            const displayToUse = batchDisplayMode || batchDisplay
            if (displayToUse && displayToUse !== 'devcontainer') startArgs.push('--display', displayToUse)
            if (flags.executor) startArgs.push('--executor', flags.executor)
            if (batchRunOnHost) startArgs.push('--run-on-host')
            if (flags.force) startArgs.push('--force')
            if (flags.focus) startArgs.push('--focus')
            // Pass action/prompt - custom action uses --prompt, others use --action
            if (batchAction === 'custom' && batchCustomMessage) {
              startArgs.push('--prompt', batchCustomMessage)
            } else if (batchAction) {
              startArgs.push('--action', batchAction)
            }
          } else {
            // Batch mode: pass all settings to skip prompts
            // batchDisplayMode is for devcontainer, batchDisplay is for host
            const displayToUse = batchDisplayMode || batchDisplay
            if (displayToUse && displayToUse !== 'devcontainer') startArgs.push('--display', displayToUse)
            if (flags.executor) startArgs.push('--executor', flags.executor)
            if (batchRunOnHost) startArgs.push('--run-on-host')
            if (flags.force) startArgs.push('--force')
            if (batchOutput) startArgs.push('--output', batchOutput)
            // Always pass permission mode to skip the prompt in work:start
            startArgs.push('--permission-mode', batchPermissionMode)
            if (batchCreatePr) startArgs.push('--create-pr')
            if (batchNoPr) startArgs.push('--no-pr')
            // Pass action/prompt - custom action uses --prompt, others use --action
            if (batchAction === 'custom' && batchCustomMessage) {
              startArgs.push('--prompt', batchCustomMessage)
            } else {
              startArgs.push('--action', batchAction || 'implement')
            }
            // Pass session manager (tmux inside container by default)
            if (flags.session) startArgs.push('--session', flags.session)
            // Pass focus flag (brings terminal to foreground)
            if (flags.focus) startArgs.push('--focus')
          }

          // eslint-disable-next-line no-await-in-loop
          await this.config.runCommand('work:start', startArgs)

          successCount++
        } catch (error) {
          failCount++
          this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
        }
      }

      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
      db.close()

      this.log('')
      this.log(styles.success(`✓ Spawn results: ${successCount} started, ${failCount} failed`))
    } catch (error) {
      db.close()
      throw error
    }
  }
}
