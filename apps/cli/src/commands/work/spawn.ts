import { Flags } from '@oclif/core'
import * as path from 'node:path'
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
  outputConfirmationNeededAsJson,
  outputExecutionResultAsJson,
} from '../../lib/prompt-json.js'
import { FlagResolver } from '../../lib/flags/index.js'
import {
  loadDietConfig,
  formatDietConfig,
  type DietConfig,
} from '../../lib/pmo/diet.js'
import type { Ticket } from '../../lib/pmo/types.js'

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
    '<%= config.bin %> <%= command.id %> --count 5 --action implement  # Top 5 by rank',
    '<%= config.bin %> <%= command.id %> --count 10 --diet --action groom  # Diet-balanced',
    '<%= config.bin %> <%= command.id %> --count 5 --category ship --action implement  # Filtered by category',
    '<%= config.bin %> <%= command.id %> --count 5 --priority P0 --action implement  # Filtered by priority',
    '<%= config.bin %> <%= command.id %> --count 10 --diet --category ship,grow --action groom  # Combined',
  ]

  static flags = {
    ...pmoBaseFlags,
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
    'permission-mode': Flags.string({
      description: 'Permission mode for Claude Code (danger=skip checks, safe=require approval)',
      options: ['danger', 'safe'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission checks (shorthand for --permission-mode danger)',
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
      description: 'Additional instructions for the agent (appended to any action prompt)',
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
    count: Flags.integer({
      char: 'n',
      description: 'Number of tickets to spawn (selects top N by rank)',
      min: 1,
    }),
    diet: Flags.boolean({
      description: 'Apply diet-balanced category weighting when selecting tickets',
      default: false,
    }),
    category: Flags.string({
      description: 'Filter tickets by category (comma-separated, e.g., ship,grow)',
    }),
    priority: Flags.string({
      description: 'Filter tickets by priority (comma-separated, e.g., P0,P1)',
    }),
    epic: Flags.string({
      description: 'Filter tickets by epic ID',
    }),
    status: Flags.string({
      description: 'Filter tickets by status name (e.g., Backlog, Ready)',
    }),
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkSpawn)

    // Handle --skip-permissions flag (alias for --permission-mode danger)
    if (flags['skip-permissions'] && flags['permission-mode']) {
      this.error(
        'Cannot use both --skip-permissions and --permission-mode flags.\n' +
        'Use only one: --skip-permissions OR --permission-mode danger/safe'
      )
    }
    if (flags['skip-permissions']) {
      flags['permission-mode'] = 'danger'
    }

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

      // Determine spawn mode: All, Many, Args, or Count
      let spawnMode: 'all' | 'many' | 'args' | 'count' = 'all'

      if (ticketIdArgs.length > 0) {
        // Ticket IDs provided as positional args
        spawnMode = 'args'
      } else if (flags.count) {
        // Count-based selection with optional filters
        spawnMode = 'count'
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
            { name: jsonMode ? 'Count - Spawn next N tickets (with optional filters)' : '🔢 Count  - Spawn next N tickets (with optional filters)', value: 'count' },
            { name: jsonMode ? 'All - Spawn all tickets in a column' : '📦 All    - Spawn all tickets tickets in a column', value: 'all' },
            { name: jsonMode ? 'Many - Select specific tickets to spawn' : '✅ Many   - Select specific tickets to spawn', value: 'many' },
          ],
        })

        const resolved = await modeResolver.resolve()
        // In JSON mode, resolve() exits after outputting prompt, so we never reach here
        // In interactive mode, we get the selected value
        spawnMode = resolved.mode as 'all' | 'many' | 'count'
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

        // In JSON mode with explicit tickets, check if we should execute or return confirmation
        if (jsonMode) {
          // Check if all required flags for non-interactive execution are provided
          const hasAction = !!flags.action
          const hasDisplay = !!flags.display || flags['run-on-host']
          const hasPermissions = flags['permission-mode'] || flags['skip-permissions'] || flags['per-ticket'] // per-ticket mode prompts individually
          const allFlagsProvided = hasAction && hasDisplay && hasPermissions

          if (allFlagsProvided && flags.yes) {
            // All flags provided and --yes is set: fall through to execution loop
            // Don't return here - continue to execution
          } else if (allFlagsProvided && !flags.yes) {
            // All flags provided but no --yes: return confirmation_needed with plan
            const metadata = createMetadata('work spawn', flags)

            // Build the confirm command with --yes
            const ticketIds = ticketsToSpawn.map(t => t.id).join(' ')
            let confirmCmd = `prlt work spawn ${ticketIds}`
            if (flags.action) confirmCmd += ` --action ${flags.action}`
            if (flags.display) confirmCmd += ` --display ${flags.display}`
            if (flags['run-on-host']) confirmCmd += ' --run-on-host'
            if (flags['permission-mode']) confirmCmd += ` --permission-mode ${flags['permission-mode']}`
            else if (flags['skip-permissions']) confirmCmd += ' --skip-permissions'
            if (flags.executor) confirmCmd += ` --executor ${flags.executor}`
            if (flags.session) confirmCmd += ` --session ${flags.session}`
            if (flags['create-pr']) confirmCmd += ' --create-pr'
            if (flags['no-pr']) confirmCmd += ' --no-pr'
            if (flags.clone) confirmCmd += ' --clone'
            if (flags.focus) confirmCmd += ' --focus'
            confirmCmd += ' --yes'

            const plan = {
              tickets: ticketsToSpawn.map(t => ({
                id: t.id,
                title: t.title,
                status: t.statusName,
              })),
              action: flags.action,
              display: flags.display || (flags['run-on-host'] ? 'host' : 'devcontainer'),
              permissions: flags['permission-mode'] || (flags['skip-permissions'] ? 'danger' : 'safe'),
              count: ticketsToSpawn.length,
            }

            db.close()
            outputConfirmationNeededAsJson(
              plan,
              confirmCmd,
              `Ready to spawn ${ticketsToSpawn.length} agent(s). Run with --yes to execute.`,
              metadata
            )
            return
          } else {
            // Missing required flags: return success with tickets selected (legacy behavior)
            // This allows the calling agent to see what tickets are available
            outputSuccessAsJson(
              {
                ticketsSelected: ticketsToSpawn.map(t => ({
                  id: t.id,
                  title: t.title,
                  status: t.statusName,
                })),
                count: ticketsToSpawn.length,
                missingFlags: {
                  action: !hasAction,
                  display: !hasDisplay,
                  permissions: !hasPermissions,
                },
              },
              createMetadata('work spawn', flags)
            )
            db.close()
            return
          }
        }

        this.log('')
        this.log(styles.header(`🚀 Spawn: ${ticketsToSpawn.length} ticket(s)`))
        this.log(styles.muted(`Tickets: ${ticketsToSpawn.map(t => t.id).join(', ')}`))

      } else if (spawnMode === 'count') {
        // COUNT MODE: Select top N tickets by rank with optional filters and diet balancing
        let targetCount = flags.count

        // If count not provided via flag (interactive mode selected 'count'), prompt for it
        if (!targetCount) {
          const countResolver = new FlagResolver<{ spawnCount?: number }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
            context: { projectId },
          })

          countResolver.addPrompt({
            flagName: 'spawnCount',
            type: 'input',
            message: 'How many agents to spawn?',
            default: '5',
            validate: (value) => {
              const num = Number.parseInt(String(value), 10)
              if (Number.isNaN(num) || num < 1) return 'Please enter a number >= 1'
              return true
            },
            transform: (value) => Number.parseInt(String(value), 10),
          })

          const countResult = await countResolver.resolve()
          targetCount = countResult.spawnCount as number
        }

        // Determine selection strategy
        let useDiet = flags.diet

        // In interactive mode, prompt for selection strategy if not specified via flags
        const hasFilterFlags = flags.category || flags.priority || flags.epic || flags.status
        if (!useDiet && !hasFilterFlags && !flags.count) {
          // Interactive mode - let user choose strategy
          const strategyResolver = new FlagResolver<{ strategy?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          strategyResolver.addPrompt({
            flagName: 'strategy',
            type: 'list',
            message: 'Selection strategy:',
            choices: () => [
              { name: jsonMode ? 'Top ranked - Select by position order' : '📊 Top ranked      - Select by position order', value: 'top' },
              { name: jsonMode ? 'Diet-balanced - Balance across category weights' : '⚖️  Diet-balanced   - Balance across category weights', value: 'diet' },
              { name: jsonMode ? 'Filtered - Pick filters to narrow selection' : '🔍 Filtered        - Pick filters to narrow selection', value: 'filtered' },
            ],
          })

          const strategyResult = await strategyResolver.resolve()

          if (strategyResult.strategy === 'diet') {
            useDiet = true
          } else if (strategyResult.strategy === 'filtered') {
            // Prompt for filters interactively
            const filterResolver = new FlagResolver<{
              filterCategory?: string
              filterPriority?: string
              filterEpic?: string
              filterStatus?: string
            }>({
              commandName: 'work spawn',
              baseCommand: 'prlt work spawn',
              jsonMode,
              flags: {},
            })

            // Get unique categories from tickets for choices
            const categories = [...new Set(allTickets.map(t => t.category).filter(Boolean))] as string[]
            if (categories.length > 0) {
              filterResolver.addPrompt({
                flagName: 'filterCategory',
                type: 'checkbox',
                message: 'Filter by category (space to toggle, enter to continue):',
                choices: () => categories.map(c => ({ name: c, value: c })),
              })
            }

            // Get unique priorities
            const priorities = [...new Set(allTickets.map(t => t.priority).filter(Boolean))] as string[]
            if (priorities.length > 0) {
              const priorityOrder = ['P0', 'P1', 'P2', 'P3']
              priorities.sort((a, b) => {
                const ai = priorityOrder.indexOf(a)
                const bi = priorityOrder.indexOf(b)
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
              })
              filterResolver.addPrompt({
                flagName: 'filterPriority',
                type: 'checkbox',
                message: 'Filter by priority (space to toggle, enter to continue):',
                choices: () => priorities.map(p => ({ name: p, value: p })),
              })
            }

            // Get epics for choices
            const epics = await this.storage.listEpics(projectId)
            if (epics.length > 0) {
              filterResolver.addPrompt({
                flagName: 'filterEpic',
                type: 'list',
                message: 'Filter by epic:',
                choices: () => [
                  { name: jsonMode ? 'Any epic' : '(any)', value: '' },
                  ...epics.map(e => ({ name: `${e.id} - ${e.title}`, value: e.id })),
                ],
              })
            }

            // Status filter
            filterResolver.addPrompt({
              flagName: 'filterStatus',
              type: 'list',
              message: 'Filter by status:',
              choices: () => [
                { name: jsonMode ? 'Any status' : '(any)', value: '' },
                ...columnNames.map(name => {
                  const count = allTickets.filter(t => t.statusName === name).length
                  return { name: `${name} (${count})`, value: name }
                }),
              ],
            })

            const filterResult = await filterResolver.resolve()
            // Apply interactive filter selections to flags for use below
            if (filterResult.filterCategory && (filterResult.filterCategory as unknown as string[]).length > 0) {
              flags.category = (filterResult.filterCategory as unknown as string[]).join(',')
            }
            if (filterResult.filterPriority && (filterResult.filterPriority as unknown as string[]).length > 0) {
              flags.priority = (filterResult.filterPriority as unknown as string[]).join(',')
            }
            if (filterResult.filterEpic) {
              flags.epic = filterResult.filterEpic
            }
            if (filterResult.filterStatus) {
              flags.status = filterResult.filterStatus
            }
          }
        }

        // Build candidate pool: start with all tickets, apply filters
        let candidates = [...allTickets]

        // Apply category filter
        if (flags.category) {
          const categoryList = flags.category.split(',').map(c => c.trim().toLowerCase())
          candidates = candidates.filter(t => {
            const ticketCat = (t.category || '').toLowerCase()
            return categoryList.includes(ticketCat)
          })
        }

        // Apply priority filter
        if (flags.priority) {
          const priorityList = flags.priority.split(',').map(p => p.trim().toUpperCase())
          candidates = candidates.filter(t => {
            const ticketPriority = (t.priority || '').toUpperCase()
            return priorityList.includes(ticketPriority)
          })
        }

        // Apply epic filter
        if (flags.epic) {
          candidates = candidates.filter(t => t.epicId === flags.epic)
        }

        // Apply status filter
        if (flags.status) {
          const statusName = flags.status.toLowerCase()
          candidates = candidates.filter(t => (t.statusName || '').toLowerCase() === statusName)
        }

        // Sort by position (rank order)
        candidates.sort((a, b) => (a.position || 0) - (b.position || 0))

        // Filter out blocked tickets
        const unblockedCandidates: Ticket[] = []
        let skippedBlocked = 0
        for (const ticket of candidates) {
          // eslint-disable-next-line no-await-in-loop -- Sequential dependency check
          const blocked = await this.storage.isTicketBlocked(ticket.id)
          if (blocked) {
            skippedBlocked++
          } else {
            unblockedCandidates.push(ticket)
          }
        }

        if (unblockedCandidates.length === 0) {
          db.close()
          const msg = `No eligible tickets found${skippedBlocked > 0 ? ` (${skippedBlocked} blocked)` : ''}.`
          return handleError('NO_ELIGIBLE_TICKETS', msg)
        }

        // Select tickets using chosen strategy
        if (useDiet) {
          // Diet-balanced selection
          const dietConfig = loadDietConfig(db)
          ticketsToSpawn = this.selectDietBalanced(unblockedCandidates, targetCount!, dietConfig)
        } else {
          // Top ranked (position order) - just take the first N
          ticketsToSpawn = unblockedCandidates.slice(0, targetCount!)
        }

        if (ticketsToSpawn.length === 0) {
          db.close()
          return handleError('NO_TICKETS_SELECTED', 'No tickets could be selected with the given criteria.')
        }

        // Show preview
        this.log('')
        this.log(styles.header(`🚀 Spawn: ${ticketsToSpawn.length} ticket(s)${useDiet ? ' (diet-balanced)' : ''}`))

        if (useDiet) {
          const dietConfig = loadDietConfig(db)
          // Show category breakdown
          const catCounts = new Map<string, number>()
          for (const t of ticketsToSpawn) {
            const cat = t.category || 'uncategorized'
            catCounts.set(cat, (catCounts.get(cat) || 0) + 1)
          }
          const breakdown = [...catCounts.entries()].map(([cat, count]) => `${count}x ${cat}`).join(', ')
          this.log(styles.muted(`  Diet:      ${formatDietConfig(dietConfig)}`))
          this.log(styles.muted(`  Breakdown: ${breakdown}`))
        }

        if (skippedBlocked > 0) {
          this.log(styles.muted(`  Skipped:   ${skippedBlocked} blocked ticket(s)`))
        }
        this.log(styles.muted(`  Tickets:   ${ticketsToSpawn.map(t => t.id).join(', ')}`))

        // Confirmation (unless --yes)
        if (!flags.yes && !jsonMode) {
          const confirmResolver = new FlagResolver<{ confirmed?: string }>({
            commandName: 'work spawn',
            baseCommand: 'prlt work spawn',
            jsonMode,
            flags: {},
          })

          confirmResolver.addPrompt({
            flagName: 'confirmed',
            type: 'list',
            message: `Spawn ${ticketsToSpawn.length} ticket(s)?`,
            choices: () => [
              { name: 'Yes', value: 'yes' },
              { name: 'No', value: 'no' },
            ],
          })

          const confirmResult = await confirmResolver.resolve()
          if (confirmResult.confirmed === 'no') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }
        }

        // In JSON mode without --yes, return confirmation_needed
        if (jsonMode && !flags.yes) {
          const metadata = createMetadata('work spawn', flags)
          const ticketIds = ticketsToSpawn.map(t => t.id).join(' ')
          let confirmCmd = `prlt work spawn ${ticketIds}`
          if (flags.action) confirmCmd += ` --action ${flags.action}`
          if (flags.display) confirmCmd += ` --display ${flags.display}`
          if (flags['run-on-host']) confirmCmd += ' --run-on-host'
          if (flags['permission-mode']) confirmCmd += ` --permission-mode ${flags['permission-mode']}`
          else if (flags['skip-permissions']) confirmCmd += ' --skip-permissions'
          if (flags.executor) confirmCmd += ` --executor ${flags.executor}`
          if (flags.session) confirmCmd += ` --session ${flags.session}`
          if (flags['create-pr']) confirmCmd += ' --create-pr'
          if (flags['no-pr']) confirmCmd += ' --no-pr'
          if (flags.clone) confirmCmd += ' --clone'
          if (flags.focus) confirmCmd += ' --focus'
          confirmCmd += ' --yes'

          const plan = {
            tickets: ticketsToSpawn.map(t => ({
              id: t.id,
              title: t.title,
              status: t.statusName,
              category: t.category,
              priority: t.priority,
            })),
            action: flags.action,
            count: ticketsToSpawn.length,
            diet: useDiet,
            filters: {
              category: flags.category || null,
              priority: flags.priority || null,
              epic: flags.epic || null,
              status: flags.status || null,
            },
          }

          db.close()
          outputConfirmationNeededAsJson(
            plan,
            confirmCmd,
            `Ready to spawn ${ticketsToSpawn.length} agent(s). Run with --yes to execute.`,
            metadata
          )
          return
        }

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

        // Build flat choices for ticket selection
        const flatChoices: Array<{ name: string; value: string }> = []
        for (const priority of PRIORITY_ORDER) {
          const tickets = ticketsByPriority.get(priority) || []
          if (tickets.length === 0) continue
          for (const ticket of tickets) {
            const statusBadge = ticket.statusName ? ` [${ticket.statusName}]` : ''
            flatChoices.push({
              name: `[${priority}] ${ticket.id} - ${ticket.title}${statusBadge}`,
              value: ticket.id,
            })
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
      const spawnJsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'work spawn' } : null

      if (ticketsWithActiveSessions.length > 0 && !jsonMode) {
        this.log(styles.warning(`Found ${ticketsWithActiveSessions.length} ticket(s) with active tmux sessions:`))
        for (const { ticketId, agent } of ticketsWithActiveSessions) {
          this.log(styles.muted(`  ${ticketId} → ${agent}`))
        }
        this.log('')

        const { sessionAction } = await this.prompt<{ sessionAction: string }>([
          {
            type: 'list',
            name: 'sessionAction',
            message: 'What would you like to do with these tickets?',
            choices: [
              { name: 'Skip them (only spawn tickets without active sessions)', value: 'skip', command: 'prlt work spawn --json' },
              { name: 'Kill sessions and respawn with new agents', value: 'kill', command: 'prlt work spawn --json' },
              { name: 'Cancel', value: 'cancel', command: '' },
            ],
          },
        ], spawnJsonModeConfig)

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
      let batchPermissionMode: PermissionMode = flags['permission-mode'] ? flags['permission-mode'] as PermissionMode : (flags['skip-permissions'] ? 'danger' : 'safe')
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
        const hasExplicitSettings = flags.display || flags.output || flags['permission-mode'] || flags['skip-permissions'] ||
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
          const devcontainerLabel = '🐳 devcontainer (sandboxed, recommended)'

          const envChoices = [
            { name: devcontainerLabel, value: 'devcontainer' },
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
              default: 'devcontainer',
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
            const { selectedEnvironment } = await this.prompt<{ selectedEnvironment: string }>([
              {
                type: 'list',
                name: 'selectedEnvironment',
                message: 'Where should agents run?',
                choices: envChoices,
                default: 'devcontainer',
              },
            ], spawnJsonModeConfig)

            if (selectedEnvironment === 'cancel') {
              db.close()
              this.log(styles.muted('Cancelled.'))
              return
            }

            if (selectedEnvironment === 'devcontainer') {
              // Dynamically check Docker when selected (user may have started it)
              if (!isDockerRunning()) {
                this.log('')
                this.warn('Docker is not running. Please start Docker and try again.')
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
              const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
                {
                  type: 'list',
                  name: 'selectedDisplay',
                  message: 'How should agent output be displayed?',
                  choices: [
                    { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: 'prlt work spawn --display terminal --json' },
                    { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background', command: 'prlt work spawn --display background --json' },
                  ],
                  default: 'terminal',
                },
              ], spawnJsonModeConfig)
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

        // Prompt for permissions mode if not explicitly set via --permission-mode or --skip-permissions flag
        if (!flags['permission-mode'] && !flags['skip-permissions']) {
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
            // In JSON mode with --yes, default to creating PRs for code-modifying actions
            if (jsonMode && flags.yes) {
              batchCreatePr = true
              batchNoPr = false
            } else {
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
            }
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

      // Track execution results for JSON output
      const executionResults: Array<{
        workId: string
        ticketId: string
        agent: string
        sessionId?: string
        containerId?: string
        status: string
      }> = []

      // Process sequentially for clear logging and resource management
      for (const ticket of ticketsToSpawn) {
        try {
          if (!jsonMode) {
            this.log(styles.muted(`Starting ${ticket.id} with ephemeral agent...`))
          }

          // Build args for work:start
          // IMPORTANT: Pass --project to avoid re-prompting for project selection
          // Pass --ephemeral to signal work:start should create an ephemeral agent
          const startArgs: string[] = [ticket.id, '--project', projectId, '--ephemeral']

          // Pass clone flag if specified
          if (flags.clone) startArgs.push('--clone')

          // In JSON mode with --yes, pass --yes to work:start to skip prompts there too
          if (jsonMode && flags.yes) {
            startArgs.push('--yes')
          }

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
            // Pass --message for additional instructions (non-custom actions)
            if (flags.message && batchAction !== 'custom') {
              startArgs.push('--message', flags.message)
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
            // Pass --message for additional instructions (non-custom actions)
            if (flags.message && batchAction !== 'custom') {
              startArgs.push('--message', flags.message)
            }
            // Pass session manager (tmux inside container by default)
            if (flags.session) startArgs.push('--session', flags.session)
            // Pass focus flag (brings terminal to foreground)
            if (flags.focus) startArgs.push('--focus')
          }

          // eslint-disable-next-line no-await-in-loop
          await this.config.runCommand('work:start', startArgs)

          successCount++

          // Track for JSON output
          executionResults.push({
            workId: `WORK-${ticket.id}`, // Placeholder - actual work ID comes from work:start
            ticketId: ticket.id,
            agent: 'ephemeral', // Ephemeral agent name determined by work:start
            status: 'running',
          })
        } catch (error) {
          failCount++
          if (!jsonMode) {
            this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
          }

          // Track failed executions for JSON output
          executionResults.push({
            workId: '',
            ticketId: ticket.id,
            agent: '',
            status: 'failed',
          })
        }
      }

      await autoExportToBoard(this.pmoPath, this.storage, (msg) => {
        if (!jsonMode) {
          this.log(styles.muted(msg))
        }
      })
      db.close()

      // Output results
      if (jsonMode) {
        // Output JSON execution results
        outputExecutionResultAsJson(
          executionResults,
          successCount,
          failCount,
          createMetadata('work spawn', flags)
        )
      } else {
        this.log('')
        this.log(styles.success(`✓ Spawn results: ${successCount} started, ${failCount} failed`))
      }
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Select tickets using diet-balanced category weighting.
   * Uses a two-pass algorithm:
   * Pass 1: Walk candidates in position order, pull if category not over ceiling.
   * Pass 2: Force-pull from underrepresented categories.
   */
  private selectDietBalanced(candidates: Ticket[], targetCount: number, dietConfig: DietConfig): Ticket[] {
    const selected: Ticket[] = []
    const selectedIds = new Set<string>()

    // Build category count map (start from zero since we're selecting fresh)
    const categoryCounts = new Map<string, number>()
    for (const ratio of dietConfig.ratios) {
      categoryCounts.set(ratio.category, 0)
    }

    // Calculate ceiling per category
    const getCeiling = (category: string): number => {
      const ratio = dietConfig.ratios.find(r => r.category === category)
      if (!ratio) return targetCount // No ceiling for uncategorized
      return Math.ceil(targetCount * ratio.target)
    }

    // Pass 1: Walk candidates in order, pull if under ceiling
    const skipped: Ticket[] = []
    for (const ticket of candidates) {
      if (selected.length >= targetCount) break

      const cat = (ticket.category || '').toLowerCase()
      const currentCount = categoryCounts.get(cat) || 0
      const ceiling = getCeiling(cat)

      if (currentCount < ceiling) {
        selected.push(ticket)
        selectedIds.add(ticket.id)
        categoryCounts.set(cat, currentCount + 1)
      } else {
        skipped.push(ticket)
      }
    }

    // Pass 2: Force-pull from underrepresented categories
    if (selected.length < targetCount) {
      for (const ratio of dietConfig.ratios) {
        if (selected.length >= targetCount) break

        const currentCount = categoryCounts.get(ratio.category) || 0
        const targetForCat = Math.ceil(targetCount * ratio.target)

        if (currentCount < targetForCat) {
          const catTickets = skipped.filter(
            t => (t.category || '').toLowerCase() === ratio.category && !selectedIds.has(t.id)
          )

          for (const ticket of catTickets) {
            if (selected.length >= targetCount) break
            if ((categoryCounts.get(ratio.category) || 0) >= targetForCat) break

            selected.push(ticket)
            selectedIds.add(ticket.id)
            categoryCounts.set(ratio.category, (categoryCounts.get(ratio.category) || 0) + 1)
          }
        }
      }
    }

    // If still under target, fill from any remaining candidates
    if (selected.length < targetCount) {
      for (const ticket of candidates) {
        if (selected.length >= targetCount) break
        if (!selectedIds.has(ticket.id)) {
          selected.push(ticket)
          selectedIds.add(ticket.id)
        }
      }
    }

    return selected
  }
}
