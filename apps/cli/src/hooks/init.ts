import { Hook } from '@oclif/core'
import { readMachineConfig, hasPromptedForTelemetryConsent, enableErrorTracking, markTelemetryPrompted } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'
import { initSentry, setCommandContext } from '../lib/telemetry/index.js'

/**
 * Init hook - runs before every command
 *
 * Responsibilities:
 * 1. Initialize Sentry error tracking (if enabled)
 * 2. Prompt for telemetry consent (first-run, opt-in)
 * 3. Detect first-time users and redirect them to the init flow
 */
const hook: Hook<'init'> = async function ({ id, config }) {
  // Initialize Sentry early (before any command runs)
  // This is safe even if user hasn't opted in - Sentry checks internally
  initSentry(config.version)

  // Set command context for error tracking
  if (id) {
    setCommandContext({ commandName: id })
  }

  // Skip telemetry prompt and first-user check for certain commands
  const skipCommands = ['init', 'help', 'config']
  if (id && skipCommands.includes(id.split(' ')[0])) {
    // Still run first-user check for non-init commands
    if (id !== 'init' && isFirstTimeUser()) {
      await handleFirstTimeUser(id, config)
    }
    return
  }

  // Handle telemetry consent prompt (first-run, opt-in)
  // Only prompt in interactive TTY environments
  if (!hasPromptedForTelemetryConsent() && isInteractiveEnvironment()) {
    await promptTelemetryConsent()
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
    await handleFirstTimeUser(id, config)
  }
}

/**
 * Handle first-time user setup
 */
async function handleFirstTimeUser(id: string, config: Parameters<typeof import('@oclif/core').run>[1]): Promise<void> {
  const chalk = await import('chalk')
  console.log(chalk.default.yellow('\n  No workspace found. Let\'s set one up first.\n'))

  // Run init command
  const { run } = await import('@oclif/core')
  await run(['init'], config)

  // Exit after init - user should re-run their original command
  console.log(chalk.default.blue(`\n  Setup complete! You can now run: prlt ${id}\n`))
  process.exit(0)
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

/**
 * Check if we're in an interactive environment where prompts are appropriate.
 * Returns false for CI, non-TTY, or explicitly disabled environments.
 */
function isInteractiveEnvironment(): boolean {
  // Check for CI environment
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return false
  }

  // Check for non-interactive TTY
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false
  }

  // Check for explicit disable
  if (process.env.PRLT_NO_TELEMETRY_PROMPT === 'true') {
    return false
  }

  return true
}

/**
 * Prompt user for telemetry consent.
 * Shows a clear disclosure of what data is collected.
 */
async function promptTelemetryConsent(): Promise<void> {
  const inquirer = await import('inquirer')
  const chalk = await import('chalk')

  console.log('')
  console.log(chalk.default.cyan('  Help improve Proletariat CLI'))
  console.log(chalk.default.dim('  ─'.repeat(25)))
  console.log('')
  console.log('  Would you like to help improve prlt by sending anonymous error reports?')
  console.log('')
  console.log(chalk.default.dim('  What we collect (only when errors occur):'))
  console.log(chalk.default.dim('    • Command name and execution mode'))
  console.log(chalk.default.dim('    • CLI version, Node.js version, OS'))
  console.log(chalk.default.dim('    • Sanitized error messages and stack traces'))
  console.log('')
  console.log(chalk.default.dim('  What we NEVER collect:'))
  console.log(chalk.default.dim('    • File paths, repository names, or workspace paths'))
  console.log(chalk.default.dim('    • Ticket content or user-generated text'))
  console.log(chalk.default.dim('    • Environment variables or secrets'))
  console.log('')
  console.log(chalk.default.dim('  You can change this anytime: prlt config telemetry'))
  console.log('')

  try {
    const { enableTracking } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'enableTracking',
        message: 'Enable anonymous error tracking?',
        choices: [
          { name: 'Yes - Help improve prlt', value: true },
          { name: 'No - Keep error tracking disabled', value: false },
        ],
        default: false,
      },
    ])

    if (enableTracking) {
      enableErrorTracking()
      // Re-initialize Sentry now that tracking is enabled
      // Note: This requires getting the CLI version, which we don't have here
      // The next command run will initialize Sentry properly
      console.log(chalk.default.green('\n  Thanks! Error tracking enabled.\n'))
    } else {
      markTelemetryPrompted()
      console.log(chalk.default.dim('\n  No problem. Error tracking remains disabled.\n'))
    }
  } catch {
    // User cancelled (Ctrl+C) - mark as prompted but don't enable
    markTelemetryPrompted()
  }
}

export default hook
