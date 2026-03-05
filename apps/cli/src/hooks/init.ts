import { Hook } from '@oclif/core'
import { validateBetterSqlite3NativeBinding } from '../lib/database/native-validation.js'
import { readMachineConfig } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'
import { getCachedUpdateInfo, triggerBackgroundCheck } from '../lib/update-check.js'
import { handleUpdatePrompt } from '../lib/update-prompt.js'

/**
 * Init hook - runs before every command
 *
 * 1. Detects first-time users and redirects them to the init flow.
 * 2. Shows an interactive update prompt when a newer version is cached.
 * 3. Triggers a background version check for the next startup.
 *
 * A user is considered "first-time" if:
 * - No workspaces are registered in machine config (~/.proletariat/config.json)
 * - AND they're not currently inside a valid HQ directory
 */
const hook: Hook<'init'> = async function ({ id, argv, config }) {
  // Commands that work without an HQ still run native module checks.
  const hqOptionalCommands = ['init', 'commit', 'claude', 'pmo:init']
  const isHqOptionalCommand = !!id && hqOptionalCommands.some(cmd => id === cmd || id.startsWith(cmd + ':'))

  // Skip when running under oclif tooling (manifest, readme generation)
  // These run commands to scan metadata and should not trigger the init flow
  if (process.env.OCLIF_COMPILATION || process.argv[1]?.includes('oclif')) {
    return
  }

  // Skip when in test environments that provide their own HQ
  if (process.env.PRLT_HQ_PATH && process.env.PRLT_TEST_ENV) {
    return
  }

  // Skip init redirect when explicitly disabled (e.g., e2e test isolation)
  if (process.env.PRLT_SKIP_INIT_REDIRECT === '1') {
    return
  }

  // Skip when --help or --version flags are present - these should always be available
  // Check both process.argv (production CLI) and the oclif-provided argv
  // (programmatic invocation via @oclif/test runCommand)
  if (process.argv.includes('--help') || process.argv.includes('-h') ||
      argv?.includes('--help') || argv?.includes('-h') ||
      process.argv.includes('--version') || process.argv.includes('-v') ||
      argv?.includes('--version') || argv?.includes('-v')) {
    return
  }

  if (shouldValidateNativeModules(id)) {
    await validateBetterSqlite3NativeBinding({ context: `command "${id}"` })
  }

  // ── Update check ────────────────────────────────────────────────────
  // Show the interactive update prompt (uses cached data only, never blocks on network).
  // Then trigger a background fetch so the cache is fresh for the next startup.
  try {
    const updateInfo = getCachedUpdateInfo(config.version)
    await handleUpdatePrompt(updateInfo)
    triggerBackgroundCheck(updateInfo.packageManager)
  } catch {
    // Never let update-check errors break the CLI
  }

  // ── First-time user detection ───────────────────────────────────────
  // Skip for help-related commands/flags
  // When user runs just `prlt` with no args, id is undefined
  if (!id || id === 'help') {
    // Check if this is first-time user running bare `prlt`
    if (!id && isFirstTimeUser()) {
      // Run init command - in TTY it prompts interactively,
      // in non-TTY it outputs a JSON prompt for the HQ name
      const { run } = await import('@oclif/core')
      await run(['init'], config)
      process.exit(0)
    }
    return
  }

  // For all other commands, check if first-time user
  if (!isHqOptionalCommand && isFirstTimeUser()) {
    const chalk = await import('chalk')
    console.log(chalk.default.yellow('\n⚠️  No headquarters found. Let\'s set one up first.\n'))

    // Run init command - in TTY it prompts interactively,
    // in non-TTY it outputs a JSON prompt for the HQ name
    const { run } = await import('@oclif/core')
    await run(['init'], config)

    console.log(chalk.default.blue(`\n✅ Setup complete! You can now run: prlt ${id}\n`))
    process.exit(0)
  }
}

function shouldValidateNativeModules(id?: string): boolean {
  if (!id) {
    return false
  }

  return !(
    id === 'help' ||
    id.startsWith('help:') ||
    id === 'plugins' ||
    id.startsWith('plugins:') ||
    id === 'autocomplete' ||
    id.startsWith('autocomplete:')
  )
}

/**
 * Check if this is a first-time user (no headquarters configured)
 */
function isFirstTimeUser(): boolean {
  // Check if user is currently inside a valid HQ directory
  const currentHQ = findHQRoot()
  if (currentHQ) {
    return false
  }

  // Check if any headquarters are registered in machine config
  const machineConfig = readMachineConfig()
  if (machineConfig.headquarters.length > 0) {
    return false
  }

  return true
}

export default hook
