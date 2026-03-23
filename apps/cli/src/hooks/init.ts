import { Hook } from '@oclif/core'
import { validateBetterSqlite3NativeBinding } from '../lib/database/native-validation.js'
import { readMachineConfig } from '../lib/machine-config.js'
import { findHQRoot } from '../lib/workspace.js'
import { getCachedUpdateInfo, triggerBackgroundCheck } from '../lib/update-check.js'
import { handleUpdatePrompt } from '../lib/update-prompt.js'
import { initSentry } from '../lib/telemetry.js'
import { initAnalytics, shutdownAnalytics, trackCommandRun } from '../lib/telemetry/analytics.js'

/**
 * Init hook - runs before every command
 *
 * 1. Detects first-time users and redirects them to the `new` command.
 * 2. Shows an interactive update prompt when a newer version is cached.
 * 3. Triggers a background version check for the next startup.
 *
 * A user is considered "first-time" if:
 * - No workspaces are registered in machine config (~/.proletariat/config.json)
 * - AND they're not currently inside a valid HQ directory
 *
 * Also initializes analytics (PostHog) for telemetry.
 */
const hook: Hook<'init'> = async function ({ id, argv, config }) {
  // Initialize Sentry as early as possible for crash reporting
  await initSentry(config.version)

  // Commands that work without an HQ still run native module checks.
  const hqOptionalCommands = ['init', 'new', 'commit', 'claude', 'pmo:init', 'telemetry']
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

  // Skip when --version flag is present - always available
  if (process.argv.includes('--version') || process.argv.includes('-v') ||
      argv?.includes('--version') || argv?.includes('-v')) {
    return
  }

  // When --help is used, show model-friendly context if no HQ is configured
  const isHelpFlag = process.argv.includes('--help') || process.argv.includes('-h') ||
      argv?.includes('--help') || argv?.includes('-h')
  if (isHelpFlag) {
    if (isFirstTimeUser()) {
      showLandingPage()
    }
    // Let oclif's help plugin render the standard help after this
    return
  }

  // Initialize analytics — fire-and-forget, events go to disk queue
  // Store command start time for duration tracking
  const commandStart = Date.now()
  ;(globalThis as Record<string, unknown>).__prlt_command_start = commandStart
  ;(globalThis as Record<string, unknown>).__prlt_command_id = id
  initAnalytics(config.version)

  // Register a process.on('exit') handler as a safety net for telemetry.
  // Most commands now return normally through oclif lifecycle (postrun hook),
  // but signal handlers still call process.exit() directly.
  // trackCommandRun → writeEventToQueue uses fs.writeFileSync, so it works
  // in synchronous exit handlers.
  if (id) {
    const cmdArgv = argv ?? []
    process.on('exit', (code) => {
      // Guard against double-tracking if postrun already ran
      if ((globalThis as Record<string, unknown>).__prlt_telemetry_tracked) return
      ;(globalThis as Record<string, unknown>).__prlt_telemetry_tracked = true

      const durationMs = Date.now() - commandStart
      const flagsUsed = cmdArgv
        .filter((arg: string) => arg.startsWith('-'))
        .map((arg: string) => arg.replace(/=.*/, ''))

      trackCommandRun({
        command: id,
        durationMs,
        success: code === 0,
        flags: flagsUsed,
      })
    })
  }

  if (shouldValidateNativeModules(id)) {
    await validateBetterSqlite3NativeBinding({ context: `command "${id}"` })
  }

  // ── Update check ────────────────────────────────────────────────────
  // Show the interactive update prompt (uses cached data only, never blocks on network).
  // Then trigger a background fetch so the cache is fresh for the next startup.
  try {
    const updateInfo = getCachedUpdateInfo(config.version)
    const updateResult = await handleUpdatePrompt(updateInfo)
    triggerBackgroundCheck(updateInfo.packageManager)
    if (updateResult === 'stop') {
      // User chose to update — exitCode already set, let oclif lifecycle complete
      return
    }
  } catch {
    // Never let update-check errors break the CLI
  }

  // ── First-time user detection ───────────────────────────────────────
  // Skip for help-related commands/flags
  // When user runs just `prlt` with no args, id is undefined
  if (!id || id === 'help') {
    // Check if this is first-time user running bare `prlt`
    if (!id && isFirstTimeUser()) {
      showLandingPage()
      await shutdownAnalytics()
      return
    }
    return
  }

  // For all other commands, check if first-time user
  if (!isHqOptionalCommand && isFirstTimeUser()) {
    showLandingPage()

    const chalk = await import('chalk')
    console.log(chalk.default.yellow(`\nRun ${chalk.default.bold('prlt new')} first, then retry: prlt ${id}\n`))
    await shutdownAnalytics()
    return
  }
}

/**
 * Show the model-friendly landing page when no HQ is configured.
 *
 * Designed to give both humans and AI models enough context to
 * understand what prlt is and how to get started.
 */
function showLandingPage(): void {
  // Check if running in a non-TTY environment (AI agent / piped output)
  const nonTTY = !process.stdout.isTTY || !process.stdin.isTTY ||
    process.env.PRLT_JSON === '1' || process.env.PRLT_JSON === 'true'

  if (nonTTY) {
    // Machine-readable output for AI models
    const output = {
      type: 'info',
      tool: 'prlt',
      description: 'AI agent orchestration platform',
      status: 'no_hq_configured',
      concepts: {
        hq: 'A headquarters (HQ) is a workspace directory that contains repos, agents, and a project board. It is the root of all prlt operations.',
        agents: 'AI coding agents that run in isolated Docker containers or git worktrees, each working on a ticket.',
        pmo: 'Project Management Office — a kanban board for tracking tickets. Can sync with Linear, Jira, Asana, Monday, Trello, or Shortcut.',
      },
      getting_started: [
        { step: 1, command: 'prlt new', description: 'Create a workspace (HQ)' },
        { step: 2, command: 'cd <name>-hq', description: 'Navigate into the new HQ' },
        { step: 3, command: 'prlt linear connect', description: 'Connect your PMO provider (Linear, Jira, Asana, etc.)' },
        { step: 4, command: 'prlt work implement TKT-1', description: 'Spawn an agent on a ticket' },
      ],
      prerequisites: [
        'Docker running',
        'A PMO account (Linear, Jira, ClickUp, Trello, Monday) — optional',
      ],
      workflow: 'prlt new → cd into HQ → connect PMO → create ticket → spawn agent → get PR',
    }
    console.log(JSON.stringify(output, null, 2))
  } else {
    // Human-readable colored output
    console.log('')
    console.log('  prlt - AI agent orchestration')
    console.log('')
    console.log('  Get started:')
    console.log('    prlt new              Create a workspace')
    console.log('    prlt linear connect   Connect your Linear board')
    console.log('    prlt work implement   Spawn an agent on a ticket')
    console.log('')
    console.log('  Prerequisites:')
    console.log('    - Docker running')
    console.log('    - A PMO account (Linear, Jira, ClickUp, Trello, Monday)')
    console.log('')
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
