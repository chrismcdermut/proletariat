import { Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import { getMachineAgents, type MachineAgentStatus } from '../../lib/registry/index.js'

export default class Agents extends Command {
  static description = 'List all agents across all projects (machine-wide registry)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --status running',
    '<%= config.bin %> <%= command.id %> --project /path/to/project',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    status: Flags.string({
      char: 's',
      description: 'Filter by agent status',
      options: ['running', 'idle', 'completed'],
    }),
    project: Flags.string({
      char: 'p',
      description: 'Filter by project path',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Agents)

    const agents = getMachineAgents({
      status: flags.status as MachineAgentStatus | undefined,
      projectPath: flags.project,
    })

    // JSON output mode
    if (flags.json) {
      this.log(JSON.stringify({ agents }, null, 2))
      return
    }

    if (agents.length === 0) {
      const filterDesc = flags.status ? ` with status "${flags.status}"` : ''
      this.log(chalk.yellow(`No agents found${filterDesc}.`))
      this.log(chalk.dim('Agents are registered when you run "prlt work start".'))
      return
    }

    // Group by project
    const byProject = new Map<string, typeof agents>()
    for (const agent of agents) {
      const list = byProject.get(agent.projectPath) || []
      list.push(agent)
      byProject.set(agent.projectPath, list)
    }

    this.log(chalk.bold.cyan('\n Machine-Wide Agent Registry\n'))

    for (const [projectPath, projectAgents] of byProject) {
      this.log(chalk.bold(`  ${projectPath}`))

      for (const agent of projectAgents) {
        const statusIcon = agent.status === 'running' ? '🟢'
          : agent.status === 'idle' ? '🟡'
          : '⚪'
        const statusColor = agent.status === 'running' ? chalk.green
          : agent.status === 'idle' ? chalk.yellow
          : chalk.dim

        const parts = [
          `${statusIcon} ${chalk.bold(agent.agentName)}`,
          statusColor(agent.status),
        ]

        if (agent.ticketId) {
          parts.push(chalk.blue(agent.ticketId))
        }

        this.log(`    ${parts.join('  ')}`)

        const spawnedAt = formatRelativeTime(agent.spawnedAt)
        const lastSeen = formatRelativeTime(agent.lastSeenAt)
        this.log(chalk.dim(`      spawned ${spawnedAt}  |  last seen ${lastSeen}`))
        if (agent.sessionId) {
          this.log(chalk.dim(`      session: ${agent.sessionId}`))
        }
      }

      this.log('')
    }

    // Summary
    const running = agents.filter(a => a.status === 'running').length
    const idle = agents.filter(a => a.status === 'idle').length
    const completed = agents.filter(a => a.status === 'completed').length

    this.log(chalk.bold('  Summary:'))
    this.log(`    ${chalk.green(`${running} running`)}  ${chalk.yellow(`${idle} idle`)}  ${chalk.dim(`${completed} completed`)}`)
    this.log(`    ${byProject.size} project(s)\n`)
  }
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then

  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
