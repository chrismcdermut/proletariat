import { Hook } from '@oclif/core'
import { readMachineConfig } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'
import {
  initSentry,
  setCommandContext,
  hasBeenPromptedForTelemetry,
  markTelemetryPrompted,
  setErrorTracking,
  isNonInteractive,
  DATA_DISCLOSURE,
} from '../lib/telemetry/sentry.js'

/**
 * Init hook - runs before every command
 *
 * Responsibilities:
 * 1. Initialize Sentry error tracking (if enabled)
 * 2. Prompt for telemetry consent on first run (interactive only)
 * 3. Detect first-time users and redirect to init flow
 */
const hook: Hook<'init'> = async function ({ id, config, argv }) {
  // Initialize Sentry early with CLI version
  initSentry(config.version)

  // Set command context for error tracking
  if (id) {
    setCommandContext(id, argv)
  }

  // Check for telemetry consent prompt (skip for certain commands)
  const skipTelemetryPrompt = ['init', 'help', 'config', 'config:telemetry']
  if (id && !skipTelemetryPrompt.includes(id)) {
    await checkTelemetryConsent()
  }

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

/**
 * Check if we need to prompt the user for telemetry consent.
 * Only prompts once and only in interactive environments.
 */
async function checkTelemetryConsent(): Promise<void> {
  // Skip if already prompted
  if (hasBeenPromptedForTelemetry()) {
    return
  }

  // Skip in non-interactive environments (CI, no TTY)
  if (isNonInteractive()) {
    // Mark as prompted so we don't check again
    markTelemetryPrompted()
    return
  }

  // Dynamic import to avoid loading inquirer unless needed
  const chalk = (await import('chalk')).default
  const inquirer = (await import('inquirer')).default

  console.log('')
  console.log(chalk.bold.cyan('━'.repeat(60)))
  console.log(chalk.bold.cyan('  Anonymous Error Tracking'))
  console.log(chalk.bold.cyan('━'.repeat(60)))
  console.log('')
  console.log(DATA_DISCLOSURE)
  console.log('')

  const { enabled } = await inquirer.prompt([
    {
      type: 'list',
      name: 'enabled',
      message: 'Enable anonymous error tracking to help improve Proletariat CLI?',
      choices: [
        { name: 'Yes - Send anonymous error reports', value: true },
        { name: 'No - Do not send any error reports', value: false },
      ],
      default: false,  // Default to opt-out for privacy
    },
  ])

  // Save the preference
  setErrorTracking(enabled)
  markTelemetryPrompted()

  if (enabled) {
    console.log(chalk.green('\n✓ Thank you for helping improve Proletariat CLI!\n'))
  } else {
    console.log(chalk.dim('\n✓ No error reports will be sent.\n'))
  }
}

export default hook
