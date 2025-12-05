import { Command, Args, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import inquirer from 'inquirer'
import Database from 'better-sqlite3'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  RuntimeMode,
  ExecutorType,
  ExecutionContext,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution } from '../../lib/execution/runners.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'

export default class TicketExecute extends Command {
  static description = 'Start an agent working on a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode foreground',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode tmux',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode terminal',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode docker',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
    mode: Flags.string({
      char: 'm',
      description: 'Runtime mode',
      options: ['foreground', 'background', 'tmux', 'terminal', 'docker', 'vm'],
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Stream output in real-time',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Execute even if already in progress',
      default: false,
    }),
    host: Flags.string({
      description: 'VM host for vm mode',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketExecute)

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch (error) {
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
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId

      if (!ticketId) {
        // Get tickets with assignees (agents)
        const allTickets = await storage.listTickets()
        const ticketsWithAssignees = allTickets.filter((t) => t.assignee)

        if (ticketsWithAssignees.length === 0) {
          await storage.close()
          db.close()
          this.error(
            'No tickets with assignees found.\n' +
              'Assign a ticket first with "prlt ticket assign <ticket-id> <agent>"'
          )
        }

        const { selectedTicketId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTicketId',
            message: 'Select ticket to execute:',
            choices: ticketsWithAssignees.map((t) => ({
              name: `${t.id} - ${t.title} (assignee: ${t.assignee})`,
              value: t.id,
            })),
          },
        ])
        ticketId = selectedTicketId
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!)
      if (!ticket) {
        await storage.close()
        db.close()
        this.error(`Ticket "${ticketId}" not found.`)
      }

      // Check assignee
      if (!ticket.assignee) {
        await storage.close()
        db.close()
        this.error(
          `Ticket "${ticketId}" has no assignee.\n` +
            `Assign an agent first with "prlt ticket assign ${ticketId} <agent>"`
        )
      }

      const agentName = ticket.assignee

      // Check if agent exists in workspace
      const agent = workspaceInfo.agents.find((a) => a.name === agentName)
      if (!agent) {
        await storage.close()
        db.close()
        this.error(
          `Agent "${agentName}" not found in workspace.\n` +
            `Add agent first with "prlt agents add ${agentName}"`
        )
      }

      // Check for running execution
      const runningExecution = executionStorage.getRunningExecution(ticketId!)
      if (runningExecution && !flags.force) {
        await storage.close()
        db.close()
        this.error(
          `Ticket "${ticketId}" already has a running execution: ${runningExecution.id}\n` +
            `Use --force to start another, or stop with "prlt execution stop ${runningExecution.id}"`
        )
      }

      // Determine worktree path
      const worktreePath = path.join(workspaceInfo.agentsPath, agentName)
      if (!fs.existsSync(worktreePath)) {
        await storage.close()
        db.close()
        this.error(
          `Agent worktree not found at ${worktreePath}.\n` +
            `Create worktree with "prlt agents add ${agentName}"`
        )
      }

      // Generate branch name
      const branch = generateBranchName(
        ticket.id,
        ticket.title,
        agentName,
        ticket.category
      )

      // Get epic info if linked
      let epicTitle: string | undefined
      if (ticket.epicId) {
        const epic = await storage.getEpic(ticket.epicId)
        epicTitle = epic?.title
      }

      // Get spec info if linked
      let specPath: string | undefined
      if (ticket.specId) {
        const spec = await storage.getSpec(ticket.specId)
        specPath = spec?.path
      }

      // Build execution context
      const context: ExecutionContext = {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        epicTitle,
        specPath,
        agentName,
        worktreePath,
        branch,
      }

      // Determine runtime mode
      const mode = (flags.mode as RuntimeMode) || DEFAULT_EXECUTION_CONFIG.defaultMode
      const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

      // Show execution info
      this.log('')
      this.log(styles.header(`🚀 Executing ${ticket.id}: ${ticket.title}`))
      this.log(styles.muted(`   Agent: ${agentName}`))
      this.log(styles.muted(`   Executor: ${executor}`))
      this.log(styles.muted(`   Mode: ${mode}`))
      this.log(styles.muted(`   Worktree: ${worktreePath}`))
      this.log(styles.muted(`   Branch: ${branch}`))
      this.log('')

      // Create branch in worktree
      this.log(styles.muted('Creating branch...'))
      try {
        // Check if branch exists
        try {
          execSync(`git rev-parse --verify ${branch}`, {
            cwd: worktreePath,
            stdio: 'pipe',
          })
          // Branch exists, check it out
          execSync(`git checkout ${branch}`, {
            cwd: worktreePath,
            stdio: 'pipe',
          })
          this.log(styles.muted(`   Checked out existing branch: ${branch}`))
        } catch {
          // Branch doesn't exist, create it
          execSync(`git checkout -b ${branch}`, {
            cwd: worktreePath,
            stdio: 'pipe',
          })
          this.log(styles.muted(`   Created new branch: ${branch}`))
        }
      } catch (error) {
        this.warn(`Could not create branch: ${error instanceof Error ? error.message : error}`)
      }

      // Create execution record
      const execution = executionStorage.createExecution({
        ticketId: ticket.id,
        agentName,
        executor,
        mode,
        branch,
      })

      this.log(styles.muted(`   Work ID: ${execution.id}`))
      this.log('')

      // Update ticket status to in_progress
      await storage.updateTicket(ticket.id, { status: 'in_progress' })
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      // Run execution
      this.log(styles.muted('Starting agent...'))
      const result = await runExecution(mode, context, executor, DEFAULT_EXECUTION_CONFIG, {
        host: flags.host,
      })

      if (result.success) {
        // Update execution record with process info
        executionStorage.updateStatus(execution.id, 'running')
        executionStorage.updateProcessInfo(execution.id, {
          pid: result.pid,
          containerId: result.containerId,
          sessionId: result.sessionId,
          logPath: result.logPath,
        })

        this.log('')
        this.log(styles.success(`✓ Work started (${execution.id})`))
        this.log('')

        if (mode !== 'foreground') {
          this.log(styles.muted('Commands:'))
          this.log(styles.muted(`  prlt execution logs ${execution.id}    View logs`))
          this.log(styles.muted(`  prlt execution stop ${execution.id}    Stop execution`))
        }
      } else {
        executionStorage.updateStatus(execution.id, 'failed')
        this.error(`Failed to start execution: ${result.error}`)
      }

      await storage.close()
      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }
}
