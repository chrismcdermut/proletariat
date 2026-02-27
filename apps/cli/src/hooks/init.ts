import { Hook } from '@oclif/core'
import { readMachineConfig } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'
import { isNonTTY } from '../lib/prompt-json.js'

/**
 * Init hook - runs before every command
 *
 * Detects first-time users and redirects them to the init flow.
 * A user is considered "first-time" if:
 * - No workspaces are registered in machine config (~/.proletariat/config.json)
 * - AND they're not currently inside a valid HQ directory
 */
const hook: Hook<'init'> = async function ({ id, argv, config }) {
  // Skip for commands that work without a workspace
  const workspaceOptionalCommands = ['init', 'commit', 'claude', 'pmo:init']
  if (id && workspaceOptionalCommands.some(cmd => id === cmd || id.startsWith(cmd + ':'))) {
    return
  }

  // Skip when running under oclif tooling (manifest, readme generation)
  // These run commands to scan metadata and should not trigger the init flow
  if (process.env.OCLIF_COMPILATION || process.argv[1]?.includes('oclif')) {
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

  // Skip for help-related commands/flags
  // When user runs just `prlt` with no args, id is undefined
  if (!id || id === 'help') {
    // Check if this is first-time user running bare `prlt`
    if (!id && isFirstTimeUser()) {
      if (isNonTTY()) {
        outputNonTTYError(id)
        return
      }
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
    // In non-TTY environments, the interactive init flow won't work -
    // output a helpful error instead of failing with "Missing required flag: --name"
    if (isNonTTY()) {
      outputNonTTYError(id)
      return
    }

    const chalk = await import('chalk')
    console.log(chalk.default.yellow('\n⚠️  No headquarters found. Let\'s set one up first.\n'))

    // Run init command
    const { run } = await import('@oclif/core')
    await run(['init'], config)

    // Exit after init - user should re-run their original command
    console.log(chalk.default.blue(`\n✅ Setup complete! You can now run: prlt ${id}\n`))
    process.exit(0)
  }
}

/**
 * Output a structured JSON error for non-TTY environments when no HQ is configured.
 * Tells agents/scripts exactly how to initialize before retrying their command.
 */
function outputNonTTYError(id?: string): void {
  const output = {
    type: 'error',
    error: {
      code: 'NO_HQ',
      message: 'No headquarters configured. Run: prlt init --name <hq-name>',
    },
    metadata: {
      command: id ?? '',
      flags: {},
      timestamp: new Date().toISOString(),
    },
  }
  console.log(JSON.stringify(output, null, 2))
  process.exit(1)
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
