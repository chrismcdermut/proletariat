/**
 * prlt web — launch the web dashboard
 *
 * Starts a lightweight HTTP server that serves a read-only dashboard
 * showing agent status, ticket board, PR status, and active sessions.
 * Uses SSE for live updates. Ctrl+C to stop.
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/base-command.js'
import { createDashboardServer } from '../lib/dashboard/server.js'
import { styles } from '../lib/styles.js'

const DEFAULT_PORT = 3000

export default class Web extends PMOCommand {
  static description = 'Start the web dashboard (read-only status view)'

  static examples = [
    '<%= config.bin %> web',
    '<%= config.bin %> web --port 8080',
    '<%= config.bin %> web --no-open',
  ]

  static flags = {
    ...pmoBaseFlags,
    port: Flags.integer({
      char: 'p',
      description: 'Port to listen on',
      default: DEFAULT_PORT,
    }),
    open: Flags.boolean({
      description: 'Open browser automatically',
      default: true,
      allowNo: true,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Web)
    const port = flags.port
    const projectId = await this.requireProject()
    const projectName = await this.getProjectName(projectId)

    this.log('')
    this.log(styles.muted('Starting dashboard server...'))

    const dashboard = await createDashboardServer({
      port,
      storage: this.storage,
      projectId,
      projectName,
    })

    this.log('')
    this.log(`  ${styles.success('Dashboard running at')} ${styles.code(dashboard.url)}`)
    this.log(styles.muted('  Press Ctrl+C to stop'))
    this.log('')

    // Open browser
    if (flags.open) {
      try {
        const platform = process.platform
        if (platform === 'darwin') {
          execSync(`open "${dashboard.url}"`, { stdio: 'ignore' })
        } else if (platform === 'linux') {
          execSync(`xdg-open "${dashboard.url}"`, { stdio: 'ignore' })
        } else if (platform === 'win32') {
          execSync(`start "${dashboard.url}"`, { stdio: 'ignore' })
        }
      } catch {
        // Browser open failed — not critical
      }
    }

    // Keep alive until Ctrl+C
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        this.log('')
        this.log(styles.muted('Shutting down dashboard...'))
        await dashboard.close()
        resolve()
      }

      process.on('SIGINT', () => void shutdown())
      process.on('SIGTERM', () => void shutdown())
    })
  }
}
