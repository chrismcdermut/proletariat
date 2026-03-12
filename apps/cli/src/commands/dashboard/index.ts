import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { createDashboardServer } from '../../lib/dashboard/server.js'
import { styles } from '../../lib/styles.js'

export default class Dashboard extends PMOCommand {
  static description = 'Open a web dashboard for viewing agents, tickets, sessions, and PRs'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --port 8080',
    '<%= config.bin %> <%= command.id %> --no-open',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    port: Flags.integer({
      description: 'Port to run the dashboard server on',
      default: 3147,
    }),
    open: Flags.boolean({
      description: 'Open dashboard in browser',
      default: true,
      allowNo: true,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Dashboard)
    const projectId = await this.requireProject()
    const jsonMode = shouldOutputJson(flags)

    // Resolve project name
    let projectName = projectId
    try {
      const project = await this.storage.getProject(projectId)
      if (project) projectName = project.name
    } catch {
      // Use projectId as fallback
    }

    const port = flags.port
    const url = `http://localhost:${port}`

    // JSON mode: output server info and exit
    if (jsonMode) {
      outputSuccessAsJson(
        {
          url,
          port,
          projectId,
          projectName,
          apiEndpoints: {
            data: `${url}/api/data`,
            events: `${url}/api/events`,
          },
        },
        createMetadata('dashboard', flags),
      )
      return
    }

    // Start dashboard server
    let dashboard
    try {
      dashboard = await createDashboardServer({
        port,
        storage: this.storage,
        projectId,
        projectName,
      })
    } catch (err) {
      this.error(err instanceof Error ? err.message : 'Failed to start dashboard server')
    }

    this.log('')
    this.log(styles.header('  prlt dashboard'))
    this.log('')
    this.log(`  ${styles.success('Server running at')} ${styles.code(dashboard.url)}`)
    this.log(`  ${styles.muted('Project:')} ${projectName}`)
    this.log('')
    this.log(styles.muted('  Press Ctrl+C to stop'))
    this.log('')

    // Open browser
    if (flags.open) {
      try {
        this.openUrl(dashboard.url)
      } catch {
        this.log(styles.muted(`  Could not open browser. Visit ${dashboard.url} manually.`))
      }
    }

    // Wait for shutdown signal
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        this.log('')
        this.log(styles.muted('  Shutting down dashboard...'))
        await dashboard.close()
        resolve()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
  }

  private openUrl(url: string): void {
    const platform = process.platform
    try {
      if (platform === 'darwin') {
        execSync(`open "${url}"`)
      } else if (platform === 'linux') {
        execSync(`xdg-open "${url}"`)
      } else if (platform === 'win32') {
        execSync(`start "" "${url}"`)
      }
    } catch {
      // Browser open failed, non-fatal
    }
  }
}
