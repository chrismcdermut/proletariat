/**
 * Interactive Update Prompt (Codex-style)
 *
 * Shows a blocking interactive prompt at startup when a cached update is
 * available. Three options via list selection (per CLAUDE.md UX rules):
 *   1. Update now — runs the package manager command and exits
 *   2. Skip — dismiss for this session only
 *   3. Skip until next version — persists dismissed_version in cache
 *
 * Suppressed in non-TTY / CI environments and when the
 * `check_for_update_on_startup` machine-level setting is disabled.
 */

import { execSync } from 'node:child_process'
import type { UpdateInfo } from './update-check.js'
import { dismissVersion, getStaleTapCommands, getStandaloneInstallDir } from './update-check.js'

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

/**
 * Returns true when the update prompt should be suppressed:
 * - Non-TTY stdout (piped output)
 * - CI environment (CI, GITHUB_ACTIONS, etc.)
 * - PRLT_NO_UPDATE_PROMPT=1 env var
 */
export function shouldSuppressPrompt(): boolean {
  if (!process.stdout.isTTY) return true
  if (!process.stdin.isTTY) return true

  // Standard CI env vars
  if (process.env.CI) return true
  if (process.env.GITHUB_ACTIONS) return true
  if (process.env.GITLAB_CI) return true
  if (process.env.JENKINS_URL) return true
  if (process.env.CIRCLECI) return true
  if (process.env.BUILDKITE) return true
  if (process.env.TRAVIS) return true
  if (process.env.TF_BUILD) return true // Azure DevOps

  // Explicit opt-out
  if (process.env.PRLT_NO_UPDATE_PROMPT === '1') return true
  if (process.env.PRLT_SKIP_NEW_VERSION_CHECK === 'true') return true

  // oclif compilation / test environments
  if (process.env.OCLIF_COMPILATION) return true
  if (process.env.PRLT_TEST_ENV) return true

  return false
}

// ---------------------------------------------------------------------------
// Stale tap guidance
// ---------------------------------------------------------------------------

/**
 * Print a warning and remediation commands when the local Homebrew tap
 * is behind origin/main. This is shown:
 * - Alongside the update prompt (if an update is available)
 * - After a failed `brew upgrade` (stale tap is a common cause)
 * - Independently when the tap is stale even if versions look current
 */
export async function printStaleTapGuidance(): Promise<void> {
  const chalk = (await import('chalk')).default
  const commands = getStaleTapCommands()

  console.log('')
  console.log(chalk.yellow('⚠️  Your Homebrew tap is out of date.'))
  console.log(chalk.dim('   The local tap checkout is behind origin/main, which can'))
  console.log(chalk.dim('   cause `brew upgrade` to report "already installed" on old versions.'))
  console.log('')
  console.log(chalk.white('   To fix, run:'))
  console.log('')
  for (const cmd of commands) {
    console.log(`     ${chalk.cyan(cmd)}`)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

type UpdateAction = 'update' | 'skip' | 'skip_version'

/**
 * Show the interactive update prompt and return the user's choice.
 *
 * ```
 * ✨ Update available! 0.3.52 → 0.3.53
 *
 * Release notes: https://github.com/chrismcdermut/proletariat/releases/latest
 *
 * › Update now (runs `brew upgrade chrismcdermut/proletariat/prlt`)
 *   Skip
 *   Skip until next version
 * ```
 */
export async function showUpdatePrompt(info: UpdateInfo): Promise<UpdateAction> {
  const chalk = (await import('chalk')).default
  const inquirer = (await import('inquirer')).default

  console.log('')
  console.log(
    `${chalk.yellow('✨ Update available!')} ${chalk.dim(info.currentVersion)} → ${chalk.green(info.latestVersion)}`,
  )
  console.log('')
  console.log(
    `Release notes: ${chalk.cyan('https://github.com/chrismcdermut/proletariat/releases/latest')}`,
  )
  console.log('')

  const choices = [
    {
      name: `Update now (runs \`${info.updateCommand}\`)`,
      value: 'update' as const,
    },
    {
      name: 'Skip',
      value: 'skip' as const,
    },
    {
      name: 'Skip until next version',
      value: 'skip_version' as const,
    },
  ]

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices,
    },
  ])

  return action as UpdateAction
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Get the shell command to run for a standalone update.
 * Downloads and pipes the installer script, passing the target version.
 */
function getStandaloneUpdateCommand(version: string | null): string {
  const installDir = getStandaloneInstallDir()
  const parts = ['curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash']
  const args: string[] = []
  if (version) args.push(`--version ${version}`)
  if (installDir) args.push(`--prefix ${installDir}`)
  if (args.length > 0) {
    parts[0] += ` -s -- ${args.join(' ')}`
  }
  return parts[0]
}

/**
 * Execute the update command, then signal the caller to stop.
 * Runs synchronously so the user sees output in real time.
 * Returns 'updated' on success or 'failed' on failure, so the
 * init hook can exit cleanly through oclif lifecycle.
 */
async function executeUpdate(info: UpdateInfo): Promise<'updated' | 'failed'> {
  const command = info.packageManager === 'standalone'
    ? getStandaloneUpdateCommand(info.latestVersion)
    : info.updateCommand

  console.log('')
  console.log(`Running: ${command}`)
  console.log('')

  try {
    execSync(command, {
      stdio: 'inherit',
      timeout: 120_000, // 2 minute timeout
    })
    console.log('')
    console.log('Update complete! Run your command again to use the new version.')
    return 'updated'
  } catch {
    console.error('')
    console.error('Update failed. You can try running the command manually:')
    console.error(`  ${command}`)

    // If brew upgrade failed and the tap is stale, show remediation
    if (info.packageManager === 'brew' && info.staleTap?.isStale) {
      await printStaleTapGuidance()
    }

    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle the full update prompt flow:
 * 1. Check if prompt should be suppressed
 * 2. If brew tap is stale, print self-heal guidance
 * 3. If an update is available, show interactive prompt
 * 4. Handle the user's choice
 *
 * Returns 'continue' if the command should proceed, or 'stop' if the
 * init hook should halt (e.g., after an update attempt).
 */
export async function handleUpdatePrompt(info: UpdateInfo): Promise<'continue' | 'stop'> {
  if (shouldSuppressPrompt()) return 'continue'

  // Show stale tap guidance when detected (even if no version update is cached)
  if (info.staleTap?.isStale) {
    await printStaleTapGuidance()
  }

  if (!info.updateAvailable) return 'continue'

  const action = await showUpdatePrompt(info)

  switch (action) {
    case 'update': {
      const result = await executeUpdate(info)
      process.exitCode = result === 'updated' ? 0 : 1
      return 'stop'
    }

    case 'skip':
      // Session-only dismiss — do nothing, just continue
      break

    case 'skip_version':
      if (info.latestVersion) {
        dismissVersion(info.latestVersion)
      }
      break
  }

  return 'continue'
}
