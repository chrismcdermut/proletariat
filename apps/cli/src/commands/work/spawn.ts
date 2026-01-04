import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { isDockerRunning } from '../../lib/execution/runners.js'

export default class WorkSpawn extends Command {
  static description = 'Spawn work for multiple tickets by column (batch mode)'

  static examples = [
    '<%= config.bin %> <%= command.id %> --column Backlog',
    '<%= config.bin %> <%= command.id %> --column "Ready for Dev"',
    '<%= config.bin %> <%= command.id %> --column Backlog --strategy round-robin',
    '<%= config.bin %> <%= command.id %> --column Backlog --dry-run',
    '<%= config.bin %> <%= command.id %>  # Interactive column selection',
  ]

  static flags = {
    column: Flags.string({
      char: 'c',
      description: 'Column name to spawn tickets from',
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
      default: 'background',
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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkSpawn)

    // Early Docker check - fail fast if Docker is needed but not running
    if (!flags['run-on-host'] && !isDockerRunning()) {
      this.error(
        'Docker is not running.\n\n' +
        'Docker is required for devcontainer execution (recommended for agent sandboxing).\n' +
        'Please start Docker Desktop and try again.\n\n' +
        'Alternatively, use --run-on-host to run directly on your machine (bypasses sandbox).'
      )
    }

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Get PMO context
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    )

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

      // Get column - prompt if not provided
      let targetColumn = flags.column

      if (!targetColumn) {
        const { selectedColumn } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedColumn',
            message: 'Select column to spawn tickets from:',
            choices: columnNames.map(name => ({ name, value: name })),
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

      // Get tickets in the selected column
      const allTickets = await storage.listTickets({ column: matchedColumn })

      // Filter to unassigned tickets only
      const unassignedTickets = allTickets.filter(t => !t.assignee)

      if (unassignedTickets.length === 0) {
        await storage.close()
        db.close()
        this.log(styles.muted(`No unassigned tickets in column "${matchedColumn}".`))
        return
      }

      // Apply limit if specified
      let ticketsToSpawn = unassignedTickets
      if (flags.limit && flags.limit > 0) {
        ticketsToSpawn = unassignedTickets.slice(0, flags.limit)
      }

      this.log('')
      this.log(styles.header(`🚀 Spawn from column: ${matchedColumn}`))
      this.log('')

      // Get available agents
      const busyAgentNames = new Set<string>()
      for (const agent of workspaceInfo.agents) {
        const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
        if (runningExecutions.length > 0) {
          busyAgentNames.add(agent.name)
        }
      }

      const availableAgents = workspaceInfo.agents.filter(a => !busyAgentNames.has(a.name))

      if (availableAgents.length === 0) {
        await storage.close()
        db.close()
        this.error('No available agents. All agents are busy with other work.')
      }

      this.log(styles.muted(`Available agents: ${availableAgents.map(a => a.name).join(', ')}`))
      this.log(styles.muted(`Tickets to spawn: ${ticketsToSpawn.map(t => t.id).join(', ')}`))
      this.log('')

      // Confirm before batch spawning (unless --yes flag is set)
      if (!flags.yes) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Spawn ${ticketsToSpawn.length} tickets using ${availableAgents.length} available agents?`,
            default: true,
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

      // Spawn each ticket
      let successCount = 0
      let failCount = 0

      for (const { ticket, agent } of assignments) {
        try {
          this.log(styles.muted(`Starting ${ticket.id} with ${agent.name}...`))

          // First assign the ticket to the agent
          await storage.updateTicket(ticket.id, { assignee: agent.name })

          // Use the work:start command for each ticket
          await this.config.runCommand('work:start', [
            ticket.id,
            '--mode', flags.mode,
            ...(flags.executor ? ['--executor', flags.executor] : []),
            ...(flags['run-on-host'] ? ['--run-on-host'] : []),
            ...(flags.force ? ['--force'] : []),
          ])

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
