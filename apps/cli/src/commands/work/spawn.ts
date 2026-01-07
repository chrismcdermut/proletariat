import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'

export default class WorkSpawn extends Command {
  static description = 'Spawn work for multiple tickets by column (batch mode)'

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Interactive: All or Many',
    '<%= config.bin %> <%= command.id %> --all              # All unassigned in selected column',
    '<%= config.bin %> <%= command.id %> --column Backlog   # All unassigned in Backlog',
    '<%= config.bin %> <%= command.id %> --many             # Multi-select specific tickets',
    '<%= config.bin %> <%= command.id %> --dry-run          # Preview without executing',
  ]

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Spawn all unassigned tickets in a column',
      default: false,
    }),
    many: Flags.boolean({
      description: 'Multi-select specific tickets to spawn',
      default: false,
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column name to spawn tickets from (used with --all)',
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
    mode: Flags.string({
      char: 'm',
      description: 'Runtime mode for spawned agents',
      options: ['foreground', 'background', 'tmux', 'terminal', 'devcontainer', 'docker', 'vm'],
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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkSpawn)

    // Note: Docker check is handled by work:start command when spawning each ticket
    // This allows for the interactive devcontainer/host selection with retry loop

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Get PMO context (filter out projects with no tickets)
    const { pmoPath, storage } = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
      promptIfMultiple: true,
      filterEmptyProjects: true,
    })

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get board to list available columns
      const board = await storage.getBoard()
      const columnNames = board.columns.map(col => col.name)

      if (columnNames.length === 0) {
        await storage.close()
        db.close()
        this.error('No columns found on the board.')
      }

      // Get all tickets
      const allTickets = await storage.listTickets()
      const unassignedTickets = allTickets.filter(t => !t.assignee)

      if (unassignedTickets.length === 0) {
        await storage.close()
        db.close()
        this.log(styles.muted('No unassigned tickets to spawn.'))
        return
      }

      // Get available agents
      const busyAgentNames = new Set<string>()
      for (const agent of workspaceInfo.agents) {
        const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
        if (runningExecutions.length > 0) {
          busyAgentNames.add(agent.name)
        }
      }
      const availableAgents = workspaceInfo.agents.filter(a => !busyAgentNames.has(a.name))

      // Determine spawn mode: All or Many
      let spawnMode: 'all' | 'many' = 'all'

      if (flags.all) {
        spawnMode = 'all'
      } else if (flags.many) {
        spawnMode = 'many'
      } else if (!flags.column) {
        // Interactive: ask user
        const { mode } = await inquirer.prompt([
          {
            type: 'list',
            name: 'mode',
            message: 'How would you like to spawn work?',
            choices: [
              { name: '📦 All    - Spawn all unassigned tickets in a column', value: 'all' },
              { name: '✅ Many   - Select specific tickets to spawn', value: 'many' },
            ],
          },
        ])
        spawnMode = mode
      }

      let ticketsToSpawn: typeof unassignedTickets = []

      if (spawnMode === 'all') {
        // ALL MODE: Column picker, then spawn all unassigned in that column
        let targetColumn = flags.column

        if (!targetColumn) {
          // Show columns with ticket counts
          const columnChoices = columnNames.map(name => {
            const count = unassignedTickets.filter(t => t.column === name).length
            return {
              name: `${name} (${count} unassigned)`,
              value: name,
            }
          })

          const { selectedColumn } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedColumn',
              message: 'Select column to spawn all unassigned tickets from:',
              choices: columnChoices,
            },
          ])
          targetColumn = selectedColumn
        }

        // Verify column exists
        const matchedColumn = columnNames.find(
          c => c.toLowerCase() === targetColumn!.toLowerCase()
        )

        if (!matchedColumn) {
          await storage.close()
          db.close()
          this.error(
            `Column "${targetColumn}" not found.\n` +
            `Available columns: ${columnNames.join(', ')}`
          )
        }

        ticketsToSpawn = unassignedTickets.filter(t => t.column === matchedColumn)

        if (ticketsToSpawn.length === 0) {
          await storage.close()
          db.close()
          this.log(styles.muted(`No unassigned tickets in column "${matchedColumn}".`))
          return
        }

        this.log('')
        this.log(styles.header(`🚀 Spawn All from: ${matchedColumn}`))

      } else {
        // MANY MODE: First pick column (or all), then multi-select tickets

        // Build column choices with counts
        const columnChoices: Array<{ name: string; value: string }> = [
          { name: '🌐 All columns (select from anywhere)', value: '__ALL__' },
        ]
        for (const name of columnNames) {
          const count = unassignedTickets.filter(t => t.column === name).length
          if (count > 0) {
            columnChoices.push({
              name: `${name} (${count} unassigned)`,
              value: name,
            })
          }
        }

        const { manyColumn } = await inquirer.prompt([
          {
            type: 'list',
            name: 'manyColumn',
            message: 'Select from which column:',
            choices: columnChoices,
          },
        ])

        // Filter tickets based on column selection
        const ticketsForSelection = manyColumn === '__ALL__'
          ? unassignedTickets
          : unassignedTickets.filter(t => t.column === manyColumn)

        if (ticketsForSelection.length === 0) {
          await storage.close()
          db.close()
          this.log(styles.muted('No unassigned tickets in that column.'))
          return
        }

        // Group tickets by column for display
        const ticketsByColumn = new Map<string, typeof unassignedTickets>()
        for (const ticket of ticketsForSelection) {
          const col = ticket.column || 'No Column'
          if (!ticketsByColumn.has(col)) {
            ticketsByColumn.set(col, [])
          }
          ticketsByColumn.get(col)!.push(ticket)
        }

        // Build choices with column separators
        const choices: Array<{ name: string; value: string } | inquirer.Separator> = []
        for (const [column, tickets] of ticketsByColumn) {
          if (manyColumn === '__ALL__') {
            choices.push(new inquirer.Separator(`── ${column} ──`))
          }
          for (const ticket of tickets) {
            choices.push({
              name: `${ticket.id} - ${ticket.title}`,
              value: ticket.id,
            })
          }
        }

        const { selectedTicketIds } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedTicketIds',
            message: 'Select tickets to spawn (space to toggle, enter to confirm):',
            choices,
            validate: (input: string[]) => {
              if (input.length === 0) {
                return 'Please select at least one ticket'
              }
              return true
            },
          },
        ])

        ticketsToSpawn = unassignedTickets.filter(t => selectedTicketIds.includes(t.id))

        this.log('')
        this.log(styles.header(`🚀 Spawn Many: ${ticketsToSpawn.length} tickets`))
      }

      // Apply limit if specified
      if (flags.limit && flags.limit > 0) {
        ticketsToSpawn = ticketsToSpawn.slice(0, flags.limit)
      }

      this.log('')

      // Check agent availability
      if (availableAgents.length === 0) {
        await storage.close()
        db.close()
        this.error(
          'No available agents. All agents are busy with other work.\n' +
          'Use "prlt agent add" to add more agents, or wait for current work to complete.'
        )
      }

      // Warn if more tickets than agents
      if (ticketsToSpawn.length > availableAgents.length) {
        this.log(styles.warning(`⚠️  ${ticketsToSpawn.length} tickets selected but only ${availableAgents.length} agents available.`))
        this.log(styles.muted(`   Only ${availableAgents.length} tickets will be spawned. Add more agents with "prlt agent add".`))
        this.log('')

        const { proceed } = await inquirer.prompt([
          {
            type: 'list',
            name: 'proceed',
            message: `Spawn ${availableAgents.length} tickets now? (${ticketsToSpawn.length - availableAgents.length} will remain unassigned)`,
            choices: [
              { name: 'Yes', value: true },
              { name: 'No', value: false },
            ],
          },
        ])

        if (!proceed) {
          await storage.close()
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }

        // Limit to available agents
        ticketsToSpawn = ticketsToSpawn.slice(0, availableAgents.length)
      }

      this.log(styles.muted(`Available agents: ${availableAgents.map(a => a.name).join(', ')}`))
      this.log(styles.muted(`Tickets to spawn: ${ticketsToSpawn.map(t => t.id).join(', ')}`))
      this.log('')

      // Confirm before batch spawning (unless --yes flag is set)
      if (!flags.yes) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'list',
            name: 'confirm',
            message: `Spawn ${ticketsToSpawn.length} tickets using ${availableAgents.length} available agents?`,
            choices: [
              { name: 'Yes', value: true },
              { name: 'No', value: false },
            ],
          },
        ])

        if (!confirm) {
          await storage.close()
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }
      }

      // Assign tickets to agents based on strategy
      const assignments: Array<{ ticket: typeof ticketsToSpawn[0]; agent: typeof availableAgents[0] }> = []

      // Track how many tickets each agent is assigned (for least-busy)
      const agentLoad = new Map<string, number>()
      for (const agent of availableAgents) {
        const runningCount = executionStorage.getAgentRunningExecutions(agent.name).length
        agentLoad.set(agent.name, runningCount)
      }

      for (let i = 0; i < ticketsToSpawn.length; i++) {
        let agent: typeof availableAgents[0]

        switch (flags.strategy) {
          case 'least-busy': {
            // Pick the agent with the fewest running executions
            let minLoad = Infinity
            let leastBusyAgent = availableAgents[0]
            for (const a of availableAgents) {
              const load = agentLoad.get(a.name) || 0
              if (load < minLoad) {
                minLoad = load
                leastBusyAgent = a
              }
            }
            agent = leastBusyAgent
            // Increment load for next iteration
            agentLoad.set(agent.name, (agentLoad.get(agent.name) || 0) + 1)
            break
          }
          case 'random': {
            // Pick a random agent
            agent = availableAgents[Math.floor(Math.random() * availableAgents.length)]
            break
          }
          case 'round-robin':
          default: {
            // Distribute evenly across agents
            agent = availableAgents[i % availableAgents.length]
            break
          }
        }

        assignments.push({ ticket: ticketsToSpawn[i], agent })
      }

      // Show assignment plan
      this.log(styles.muted(`Strategy: ${flags.strategy}`))
      this.log(styles.muted('Assignment plan:'))
      for (const { ticket, agent } of assignments) {
        this.log(styles.muted(`  ${ticket.id} → ${agent.name}`))
      }
      this.log('')

      // Dry run - just show what would happen
      if (flags['dry-run']) {
        await storage.close()
        db.close()
        this.log(styles.success(`✓ Dry run complete: would spawn ${assignments.length} tickets`))
        return
      }

      // Batch mode settings - prompt once for all tickets
      let batchMode = flags.mode
      let batchOutput = flags.output
      let batchSkipPermissions = flags['skip-permissions']
      let batchCreatePr = flags['create-pr']
      let batchNoPr = flags['no-pr']
      let batchRunOnHost = flags['run-on-host']

      // Check if any agent has devcontainer config
      const hasDevcontainer = availableAgents.some(agent => {
        const agentDir = path.join(workspaceInfo.agentsPath, agent.name)
        return hasDevcontainerConfig(agentDir)
      })

      if (!flags['per-ticket']) {
        this.log(styles.header('Batch Settings (applies to all tickets)'))
        this.log('')

        // Prompt for environment (devcontainer vs host) if devcontainer available
        if (hasDevcontainer && !batchRunOnHost && !batchMode) {
          let environmentSelected = false
          while (!environmentSelected) {
            const { selectedEnvironment } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedEnvironment',
                message: 'Where should agents run?',
                choices: [
                  { name: '🐳 devcontainer (sandboxed, recommended)', value: 'devcontainer' },
                  { name: '💻 host (runs directly on your machine)', value: 'host' },
                  { name: '✗  cancel', value: 'cancel' },
                ],
                default: 'devcontainer',
              },
            ])

            if (selectedEnvironment === 'cancel') {
              await storage.close()
              db.close()
              this.log(styles.muted('Cancelled.'))
              return
            }

            if (selectedEnvironment === 'devcontainer') {
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
              batchMode = 'devcontainer'
              environmentSelected = true
            } else {
              batchRunOnHost = true
              environmentSelected = true
            }
          }
        }

        // Prompt for display mode if not already set (for host mode or devcontainer)
        if (!batchMode) {
          const { selectedMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedMode',
              message: 'How should agent output be displayed?',
              choices: [
                { name: '🖥️  terminal     - New terminal window (recommended)', value: 'terminal' },
                { name: '📺 foreground  - Current terminal', value: 'foreground' },
                { name: '🔲 tmux        - Tmux pane/window', value: 'tmux' },
                { name: '📦 background  - Detached (logs to file)', value: 'background' },
              ],
            },
          ])
          batchMode = selectedMode
        }

        // Prompt for output mode if not provided
        if (!batchOutput) {
          const { selectedOutput } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedOutput',
              message: 'How should Claude display output?',
              choices: [
                { name: 'interactive  - Watch Claude work in real-time', value: 'interactive' },
                { name: 'print        - Show final result only', value: 'print' },
              ],
              default: 'interactive',
            },
          ])
          batchOutput = selectedOutput
        }

        // Prompt for permissions mode if not provided
        if (!batchSkipPermissions) {
          const { permissionMode } = await inquirer.prompt([
            {
              type: 'list',
              name: 'permissionMode',
              message: 'Permission mode for Claude Code:',
              choices: [
                { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
                { name: '⚠️  danger - Skip permission checks', value: 'danger' },
              ],
              default: 'safe',
            },
          ])
          batchSkipPermissions = permissionMode === 'danger'
        }

        // Prompt for PR creation if not provided
        if (!batchCreatePr && !batchNoPr) {
          const { prChoice } = await inquirer.prompt([
            {
              type: 'list',
              name: 'prChoice',
              message: 'Create pull requests when work is ready?',
              choices: [
                { name: '✓ Yes - Create PR for each ticket', value: 'yes' },
                { name: '✗ No  - Just move tickets to review', value: 'no' },
              ],
              default: 'yes',
            },
          ])
          batchCreatePr = prChoice === 'yes'
          batchNoPr = prChoice === 'no'
        }

        this.log('')
      }

      // Spawn each ticket
      let successCount = 0
      let failCount = 0

      for (const { ticket, agent } of assignments) {
        try {
          this.log(styles.muted(`Starting ${ticket.id} with ${agent.name}...`))

          // First assign the ticket to the agent
          await storage.updateTicket(ticket.id, { assignee: agent.name })

          // Build args for work:start
          const startArgs: string[] = [ticket.id]

          if (flags['per-ticket']) {
            // Per-ticket mode: only pass mode flag, let start prompt for the rest
            if (batchMode) startArgs.push('--mode', batchMode)
            if (flags.executor) startArgs.push('--executor', flags.executor)
            if (batchRunOnHost) startArgs.push('--run-on-host')
            if (flags.force) startArgs.push('--force')
          } else {
            // Batch mode: pass all settings to skip prompts
            if (batchMode) startArgs.push('--mode', batchMode)
            if (flags.executor) startArgs.push('--executor', flags.executor)
            if (batchRunOnHost) startArgs.push('--run-on-host')
            if (flags.force) startArgs.push('--force')
            if (batchOutput) startArgs.push('--output', batchOutput)
            if (batchSkipPermissions) startArgs.push('--skip-permissions')
            if (batchCreatePr) startArgs.push('--create-pr')
            if (batchNoPr) startArgs.push('--no-pr')
          }

          await this.config.runCommand('work:start', startArgs)

          successCount++
        } catch (error) {
          failCount++
          this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
        }
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()
      db.close()

      this.log('')
      this.log(styles.success(`✓ Spawn complete: ${successCount} started, ${failCount} failed`))
    } catch (error) {
      db.close()
      throw error
    }
  }
}
