import { Hook } from '@oclif/core'
import { readMachineConfig } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'

/**
 * Init hook - runs before every command
 *
 * Detects first-time users and redirects them to the init flow.
 * A user is considered "first-time" if:
 * - No workspaces are registered in machine config (~/.proletariat/config.json)
 * - AND they're not currently inside a valid HQ directory
 */
const hook: Hook<'init'> = async function ({ id, config }) {
  // Skip for init command to avoid infinite loop
  if (id === 'init') {
    return
  }

  // Skip for help-related commands/flags
  // When user runs just `prlt` with no args, id is undefined
  if (!id || id === 'help') {
    // Check if this is first-time user running bare `prlt`
    if (!id && isFirstTimeUser()) {
      // Run init command
      const { run } = await import('@oclif/core')
      await run(['init'], config)
      // Exit after init completes to prevent showing help
      process.exit(0)
    }
    return
  }

  // For all other commands, check if first-time user
  if (isFirstTimeUser()) {
    const chalk = await import('chalk')
    console.log(chalk.default.yellow('\n⚠️  No workspace found. Let\'s set one up first.\n'))

    // Run init command
    const { run } = await import('@oclif/core')
    await run(['init'], config)

    // Exit after init - user should re-run their original command
    console.log(chalk.default.blue(`\n✅ Setup complete! You can now run: prlt ${id}\n`))
    process.exit(0)
  }
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
