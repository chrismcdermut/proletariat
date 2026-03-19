import { Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { colors } from '../lib/colors.js'
import { machineOutputFlags } from '../lib/pmo/index.js'
import { shouldOutputJson } from '../lib/prompt-json.js'
import {
  detectPackageManager,
  fetchLatestVersion,
  getUpdateCommand,
  getStandaloneInstallDir,
  isNewerVersion,
  type PackageManager,
} from '../lib/update-check.js'

export default class Update extends Command {
  static aliases = ['self-update']

  static description = 'Update prlt to the latest version'

  static examples = [
    '<%= config.bin %> update',
    '<%= config.bin %> update --check',
    '<%= config.bin %> update --force',
  ]

  static flags = {
    ...machineOutputFlags,
    check: Flags.boolean({
      description: 'Check for updates without installing',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force update even if already on latest version',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Update)
    const jsonMode = shouldOutputJson(flags)

    const currentVersion = this.config.version
    const pm = detectPackageManager()

    if (!jsonMode) {
      this.log('')
      this.log(colors.primary('Proletariat CLI Update'))
      this.log('')
      this.log(`  Current version:  ${colors.text(currentVersion)}`)
      this.log(`  Install method:   ${colors.text(pm)}`)
    }

    // Fetch latest version
    const latestVersion = await fetchLatestVersion(pm === 'standalone' ? 'npm' : pm)

    if (!latestVersion) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: false,
          error: 'Could not fetch latest version from registry',
          currentVersion,
          packageManager: pm,
        }, null, 2))
      } else {
        this.log('')
        this.log(colors.error('Could not fetch latest version. Check your network connection.'))
      }
      this.exit(1)
    }

    const updateAvailable = isNewerVersion(currentVersion, latestVersion)

    if (!jsonMode) {
      this.log(`  Latest version:   ${colors.text(latestVersion)}`)
      this.log('')
    }

    // --check mode: just report and exit
    if (flags.check) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: true,
          currentVersion,
          latestVersion,
          updateAvailable,
          packageManager: pm,
          updateCommand: getUpdateCommand(pm),
        }, null, 2))
      } else if (updateAvailable) {
        this.log(`  ${colors.warning('Update available!')} ${currentVersion} → ${colors.success(latestVersion)}`)
        this.log(`  Run ${colors.primary('prlt update')} to install`)
      } else {
        this.log(`  ${colors.success('You are on the latest version.')}`)
      }
      return
    }

    // No update available (and not forced)
    if (!updateAvailable && !flags.force) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: true,
          currentVersion,
          latestVersion,
          updateAvailable: false,
          message: 'Already on the latest version',
        }, null, 2))
      } else {
        this.log(`  ${colors.success('Already on the latest version.')}`)
        this.log('')
      }
      return
    }

    // Perform the update
    const command = this.getUpdateShellCommand(pm, latestVersion)

    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        action: 'updating',
        currentVersion,
        latestVersion,
        packageManager: pm,
        command,
      }, null, 2))
    } else {
      this.log(`  Updating ${currentVersion} → ${latestVersion}…`)
      this.log('')
      this.log(`  Running: ${colors.textMuted(command)}`)
      this.log('')
    }

    try {
      execSync(command, {
        stdio: 'inherit',
        timeout: 120_000,
      })

      if (!jsonMode) {
        this.log('')
        this.log(colors.success('Update complete!') + ' Run your command again to use the new version.')
        this.log('')
      }
    } catch {
      if (!jsonMode) {
        this.log('')
        this.log(colors.error('Update failed.') + ' Try running the command manually:')
        this.log(`  ${command}`)
        this.log('')
        this.printTroubleshootingHelp(pm)
      }
      this.exit(1)
    }
  }

  /**
   * Build the shell command for the detected install method.
   */
  private getUpdateShellCommand(pm: PackageManager, version: string): string {
    switch (pm) {
      case 'brew':
        return 'brew upgrade chrismcdermut/proletariat/prlt'
      case 'standalone': {
        const installDir = getStandaloneInstallDir()
        const parts = [
          'curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash',
        ]
        const args: string[] = []
        if (version) args.push(`--version ${version}`)
        if (installDir) args.push(`--prefix ${installDir}`)
        if (args.length > 0) {
          parts[0] += ` -s -- ${args.join(' ')}`
        }
        return parts[0]
      }
      default:
        return 'npm install -g @proletariat/cli'
    }
  }

  private printTroubleshootingHelp(pm: PackageManager): void {
    if (pm === 'brew') {
      this.log('  If brew reports "already installed", your tap may be stale:')
      this.log(`    ${colors.textMuted('brew tap --force chrismcdermut/proletariat')}`)
      this.log(`    ${colors.textMuted('brew upgrade chrismcdermut/proletariat/prlt')}`)
      this.log('')
    }

    if (pm === 'npm') {
      this.log('  If npm fails with EEXIST, another install method may be conflicting.')
      this.log(`  See: ${colors.textMuted('prlt update --help')} or`)
      this.log(`  Docs: ${colors.textMuted('https://github.com/chrismcdermut/proletariat/blob/main/docs/switching-install-methods.md')}`)
      this.log('')
    }

    if (pm === 'standalone') {
      this.log('  If the standalone installer fails, try re-running manually:')
      this.log(`    ${colors.textMuted('curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash')}`)
      this.log('')
    }
  }
}
