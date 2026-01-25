/**
 * Execution Configuration Storage
 *
 * Stores user preferences for execution settings in the workspace SQLite database.
 * Uses the workspace_settings table (not pmo_settings - execution is workspace-level).
 */

import Database from 'better-sqlite3'
import inquirer from 'inquirer'
import { ExecutionConfig, DEFAULT_EXECUTION_CONFIG, TerminalApp, Shell, DisplayMode, OutputMode, ExecutionEnvironment } from './types.js'
import { isGHInstalled, isGHAuthenticated } from '../pr/index.js'

import { execSync } from 'node:child_process'

const SETTINGS_TABLE = 'workspace_settings'

// Config keys stored in workspace_settings table
const CONFIG_KEYS = {
  terminalApp: 'execution.terminal.app',
  terminalOpenInBackground: 'execution.terminal.open_in_background',
  shell: 'execution.shell',
  defaultMode: 'execution.default_mode',
  defaultExecutor: 'execution.default_executor',
  autoExecute: 'execution.auto_execute',
  tmuxSession: 'execution.tmux.session',
  tmuxLayout: 'execution.tmux.layout',
  tmuxControlMode: 'execution.tmux.control_mode',
  dockerImage: 'execution.docker.image',
  dockerNetwork: 'execution.docker.network',
  dockerMemory: 'execution.docker.memory',
  dockerCpus: 'execution.docker.cpus',
  vmDefaultHost: 'execution.vm.default_host',
  vmUser: 'execution.vm.user',
  vmKeyPath: 'execution.vm.key_path',
  vmSyncMethod: 'execution.vm.sync_method',
  coderName: 'coder.name',
}

/**
 * Get a setting value from the database
 */
function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Set a setting value in the database
 */
function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

/**
 * Load execution config from database, merging with defaults
 */
export function loadExecutionConfig(db: Database.Database): ExecutionConfig {
  const config = { ...DEFAULT_EXECUTION_CONFIG }

  // Load terminal app
  const terminalApp = getSetting(db, CONFIG_KEYS.terminalApp)
  if (terminalApp) {
    config.terminal = { ...config.terminal, app: terminalApp as TerminalApp }
  }

  // Load terminal open in background setting
  const terminalOpenInBackground = getSetting(db, CONFIG_KEYS.terminalOpenInBackground)
  if (terminalOpenInBackground !== null) {
    config.terminal = { ...config.terminal, openInBackground: terminalOpenInBackground === 'true' }
  }

  // Load shell
  const shell = getSetting(db, CONFIG_KEYS.shell)
  if (shell) {
    config.shell = shell as Shell
  }

  // Load default environment
  const defaultEnvironment = getSetting(db, CONFIG_KEYS.defaultMode)
  if (defaultEnvironment) {
    config.defaultEnvironment = defaultEnvironment as ExecutionConfig['defaultEnvironment']
  }

  // Load default executor
  const defaultExecutor = getSetting(db, CONFIG_KEYS.defaultExecutor)
  if (defaultExecutor) {
    config.defaultExecutor = defaultExecutor as ExecutionConfig['defaultExecutor']
  }

  // Load auto execute
  const autoExecute = getSetting(db, CONFIG_KEYS.autoExecute)
  if (autoExecute !== null) {
    config.autoExecute = autoExecute === 'true'
  }

  // Load tmux settings
  const tmuxSession = getSetting(db, CONFIG_KEYS.tmuxSession)
  if (tmuxSession) {
    config.tmux = { ...config.tmux, session: tmuxSession }
  }
  const tmuxLayout = getSetting(db, CONFIG_KEYS.tmuxLayout)
  if (tmuxLayout) {
    config.tmux = { ...config.tmux, layout: tmuxLayout as 'split' | 'window' }
  }
  const tmuxControlMode = getSetting(db, CONFIG_KEYS.tmuxControlMode)
  if (tmuxControlMode !== null) {
    config.tmux = { ...config.tmux, controlMode: tmuxControlMode === 'true' }
  }

  // Load docker settings
  const dockerImage = getSetting(db, CONFIG_KEYS.dockerImage)
  if (dockerImage) {
    config.docker = { ...config.docker, image: dockerImage }
  }
  const dockerNetwork = getSetting(db, CONFIG_KEYS.dockerNetwork)
  if (dockerNetwork) {
    config.docker = { ...config.docker, network: dockerNetwork }
  }
  const dockerMemory = getSetting(db, CONFIG_KEYS.dockerMemory)
  if (dockerMemory) {
    config.docker = { ...config.docker, memory: dockerMemory }
  }
  const dockerCpus = getSetting(db, CONFIG_KEYS.dockerCpus)
  if (dockerCpus) {
    config.docker = { ...config.docker, cpus: parseInt(dockerCpus, 10) }
  }

  // Load VM settings
  const vmDefaultHost = getSetting(db, CONFIG_KEYS.vmDefaultHost)
  if (vmDefaultHost) {
    config.vm = { ...config.vm, defaultHost: vmDefaultHost }
  }
  const vmUser = getSetting(db, CONFIG_KEYS.vmUser)
  if (vmUser) {
    config.vm = { ...config.vm, user: vmUser }
  }
  const vmKeyPath = getSetting(db, CONFIG_KEYS.vmKeyPath)
  if (vmKeyPath) {
    config.vm = { ...config.vm, keyPath: vmKeyPath }
  }
  const vmSyncMethod = getSetting(db, CONFIG_KEYS.vmSyncMethod)
  if (vmSyncMethod) {
    config.vm = { ...config.vm, syncMethod: vmSyncMethod as 'rsync' | 'git' }
  }

  return config
}

/**
 * Save a single execution config setting to database
 */
export function saveExecutionSetting(db: Database.Database, key: keyof typeof CONFIG_KEYS, value: string): void {
  setSetting(db, CONFIG_KEYS[key], value)
}

/**
 * Save terminal app preference
 */
export function saveTerminalApp(db: Database.Database, app: TerminalApp): void {
  setSetting(db, CONFIG_KEYS.terminalApp, app)
}

/**
 * Save shell preference
 */
export function saveShell(db: Database.Database, shell: Shell): void {
  setSetting(db, CONFIG_KEYS.shell, shell)
}

/**
 * Save tmux control mode preference.
 * When enabled and using iTerm, tmux -CC is used for native tab integration.
 */
export function saveTmuxControlMode(db: Database.Database, enabled: boolean): void {
  setSetting(db, CONFIG_KEYS.tmuxControlMode, enabled.toString())
}

/**
 * Save terminal open in background preference.
 * When enabled, new terminal tabs open without stealing focus from current window.
 */
export function saveTerminalOpenInBackground(db: Database.Database, enabled: boolean): void {
  setSetting(db, CONFIG_KEYS.terminalOpenInBackground, enabled.toString())
}

/**
 * Check if terminal app preference has been set
 */
export function hasTerminalPreference(db: Database.Database): boolean {
  return getSetting(db, CONFIG_KEYS.terminalApp) !== null
}

/**
 * Check if shell preference has been set
 */
export function hasShellPreference(db: Database.Database): boolean {
  return getSetting(db, CONFIG_KEYS.shell) !== null
}

/**
 * Auto-detect terminal app from environment.
 * Uses TERM_PROGRAM env var set by most terminal emulators.
 */
export function detectTerminalApp(): TerminalApp | null {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || ''

  // Map TERM_PROGRAM values to our TerminalApp type
  if (termProgram === 'iterm.app') return 'iTerm'
  if (termProgram === 'apple_terminal') return 'Terminal'
  if (termProgram === 'alacritty') return 'Alacritty'
  if (termProgram === 'wezterm') return 'WezTerm'
  if (termProgram === 'ghostty') return 'Ghostty'
  if (termProgram === 'kitty') return 'Kitty'
  if (termProgram === 'warp') return 'Warp'

  // Also check TERMINAL_EMULATOR for some apps
  const termEmulator = process.env.TERMINAL_EMULATOR?.toLowerCase() || ''
  if (termEmulator.includes('jetbrains')) return 'tmux' // IDE terminal, fall back to tmux

  return null
}

/**
 * Auto-detect shell from environment.
 * Uses SHELL env var.
 */
export function detectShell(): Shell | null {
  const shellPath = process.env.SHELL || ''
  const shellName = shellPath.split('/').pop()?.toLowerCase() || ''

  if (shellName === 'zsh') return 'zsh'
  if (shellName === 'bash') return 'bash'
  if (shellName === 'fish') return 'fish'

  return null
}

/**
 * Prompt user for terminal app preference (first-time setup)
 */
export async function promptTerminalPreference(db: Database.Database): Promise<TerminalApp> {
  const { terminalApp } = await inquirer.prompt([
    {
      type: 'list',
      name: 'terminalApp',
      message: 'Which terminal app would you like to use for agent execution?',
      choices: [
        { name: 'iTerm', value: 'iTerm' },
        { name: 'Terminal.app (macOS default)', value: 'Terminal' },
        { name: 'Alacritty', value: 'Alacritty' },
        { name: 'Ghostty', value: 'Ghostty' },
        { name: 'Kitty', value: 'Kitty' },
        { name: 'tmux', value: 'tmux' },
        { name: 'Warp', value: 'Warp' },
        { name: 'WezTerm', value: 'WezTerm' },
      ],
      default: 'iTerm',
    },
  ])

  // Save preference to database
  saveTerminalApp(db, terminalApp)

  // If iTerm selected, prompt for control mode preference
  if (terminalApp === 'iTerm') {
    await promptTmuxControlModePreference(db)
  }

  return terminalApp
}

/**
 * Prompt user for tmux control mode preference (iTerm only).
 * When enabled, tmux -CC is used for native iTerm tab/window integration.
 */
export async function promptTmuxControlModePreference(db: Database.Database): Promise<boolean> {
  const { useControlMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'useControlMode',
      message: 'iTerm tmux integration mode:',
      choices: [
        {
          name: 'Native tabs (tmux -CC) - iTerm handles windows/scrollback natively (Recommended)',
          value: true,
        },
        {
          name: 'Standard tmux - Traditional tmux interface inside iTerm',
          value: false,
        },
      ],
      default: true,
    },
  ])

  // Save preference to database
  saveTmuxControlMode(db, useControlMode)

  return useControlMode
}

/**
 * Get terminal app, auto-detecting or prompting if not set
 */
export async function getTerminalApp(db: Database.Database): Promise<TerminalApp> {
  const config = loadExecutionConfig(db)

  // If already set, return it
  if (hasTerminalPreference(db)) {
    return config.terminal.app
  }

  // Try auto-detection first
  const detected = detectTerminalApp()
  if (detected) {
    saveTerminalApp(db, detected)
    // If iTerm detected, also enable control mode by default (best experience)
    if (detected === 'iTerm') {
      saveTmuxControlMode(db, true)
    }
    return detected
  }

  // Fall back to prompting user
  return promptTerminalPreference(db)
}

/**
 * Prompt user for shell preference (first-time setup)
 */
export async function promptShellPreference(db: Database.Database): Promise<Shell> {
  const { shell } = await inquirer.prompt([
    {
      type: 'list',
      name: 'shell',
      message: 'Which shell do you use?',
      choices: [
        { name: 'zsh (macOS default)', value: 'zsh' },
        { name: 'bash', value: 'bash' },
        { name: 'fish', value: 'fish' },
      ],
      default: 'zsh',
    },
  ])

  // Save preference to database
  saveShell(db, shell)

  return shell
}

/**
 * Get shell, auto-detecting or prompting if not set
 */
export async function getShell(db: Database.Database): Promise<Shell> {
  const config = loadExecutionConfig(db)

  // If already set, return it
  if (hasShellPreference(db)) {
    return config.shell
  }

  // Try auto-detection first
  const detected = detectShell()
  if (detected) {
    saveShell(db, detected)
    return detected
  }

  // Fall back to prompting user
  return promptShellPreference(db)
}

// =============================================================================
// Execution Prompt Options
// =============================================================================

export interface ExecutionPromptOptions {
  /** Display mode selected by user */
  displayMode: DisplayMode
  /** Environment selected by user */
  environment: ExecutionEnvironment
  /** Skip output mode prompt and use this value instead */
  outputMode?: OutputMode
  /** Skip permission prompt and use this value instead */
  skipPermissions?: boolean
  /** Skip PR prompt and use this value instead */
  createPR?: boolean
  /** Force re-prompt for terminal preferences */
  reconfigure?: boolean
  /** Log function for status messages */
  log?: (msg: string) => void
}

export interface ExecutionPromptResult {
  /** Execution config with terminal/shell/output settings */
  executionConfig: ExecutionConfig
  /** Whether to skip permission checks */
  skipPermissions: boolean
  /** Whether to create PR when work is ready */
  createPR: boolean
}

/**
 * Prompt for all execution settings in a consistent way.
 * Used by work start, work spawn, and work watch commands.
 */
export async function promptExecutionSettings(
  db: Database.Database,
  options: ExecutionPromptOptions
): Promise<ExecutionPromptResult> {
  const { displayMode, environment, log = () => {} } = options

  // Load execution config from database
  const executionConfig = loadExecutionConfig(db)

  // If terminal display mode, ensure terminal and shell preferences are set (prompts on first use)
  const needsTerminalConfig = displayMode === 'terminal'
  if (needsTerminalConfig) {
    const needsTerminal = !hasTerminalPreference(db)
    const needsShell = !hasShellPreference(db)

    // First-time setup header
    if ((needsTerminal || needsShell) && !options.reconfigure) {
      log('First-time execution setup')
      log('')
    }

    let terminalApp: TerminalApp
    let shell: Shell

    if (options.reconfigure) {
      terminalApp = await promptTerminalPreference(db)
      shell = await promptShellPreference(db)
    } else {
      terminalApp = await getTerminalApp(db)
      shell = await getShell(db)
    }

    executionConfig.terminal.app = terminalApp
    executionConfig.shell = shell
  }

  // Prompt for output mode (interactive vs print)
  // Only show this for terminal mode where streaming makes sense (not background)
  let outputMode: OutputMode = options.outputMode ?? DEFAULT_EXECUTION_CONFIG.outputMode
  const streamingDisplayModes: DisplayMode[] = ['terminal']

  if (options.outputMode === undefined && streamingDisplayModes.includes(displayMode)) {
    const { selectedOutputMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedOutputMode',
        message: 'How should Claude display output?',
        choices: [
          { name: 'interactive  - Watch Claude work in real-time (streaming UI)', value: 'interactive' },
          { name: 'print        - Show final result only (better for logs)', value: 'print' },
        ],
        default: 'interactive',
      },
    ])
    outputMode = selectedOutputMode as OutputMode
  }
  executionConfig.outputMode = outputMode

  // Prompt for permissions mode (unless flag override is provided)
  let skipPermissions = options.skipPermissions ?? false
  if (options.skipPermissions === undefined) {
    const containerNote = (environment === 'devcontainer' || environment === 'docker')
      ? ' (container provides additional isolation)'
      : ''
    const { permissionMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'permissionMode',
        message: `Permission mode for Claude Code${containerNote}:`,
        choices: [
          { name: '🔒 safe   - Requires approval for dangerous operations (recommended)', value: 'safe' },
          { name: '⚠️  danger - Skip permission checks (--dangerously-skip-permissions)', value: 'danger' },
        ],
        default: 'safe',
      },
    ])
    skipPermissions = permissionMode === 'danger'
  }

  // Prompt for PR creation when work is complete (unless flag override is provided)
  let createPR = options.createPR ?? false
  if (options.createPR === undefined) {
    const ghAvailable = isGHInstalled() && isGHAuthenticated()
    if (ghAvailable) {
      const { prChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'prChoice',
          message: 'Create a pull request when work is ready?',
          choices: [
            { name: '✓ Yes - Create PR when running `prlt work ready`', value: 'yes' },
            { name: '✗ No  - Just move ticket to review (can create PR later)', value: 'no' },
          ],
          default: 'yes',
        },
      ])
      createPR = prChoice === 'yes'
    }
  }

  return {
    executionConfig,
    skipPermissions,
    createPR,
  }
}

// =============================================================================
// Coder Name Configuration
// =============================================================================

/**
 * Get GitHub username via gh CLI.
 * Returns null if gh is not installed or not authenticated.
 */
export function getGitHubUsername(): string | null {
  try {
    const username = execSync('gh api user --jq .login', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return username || null
  } catch {
    return null
  }
}

/**
 * Get git config user.name as default coder name.
 * Returns null if git user.name is not configured.
 */
export function getGitUserName(): string | null {
  try {
    const userName = execSync('git config user.name', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return userName || null
  } catch {
    return null
  }
}

/**
 * Get the configured coder name from the database.
 * Returns null if not configured.
 */
export function getCoderName(db: Database.Database): string | null {
  return getSetting(db, CONFIG_KEYS.coderName)
}

/**
 * Save coder name preference to database.
 */
export function saveCoderName(db: Database.Database, name: string): void {
  setSetting(db, CONFIG_KEYS.coderName, name)
}

/**
 * Check if coder name has been configured.
 */
export function hasCoderName(db: Database.Database): boolean {
  return getSetting(db, CONFIG_KEYS.coderName) !== null
}

/**
 * Prompt user for coder name preference (first-time setup).
 * Uses git config user.name as default if available.
 */
export async function promptCoderName(db: Database.Database): Promise<string> {
  const gitUserName = getGitUserName()
  const defaultName = gitUserName
    ? gitUserName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : ''

  const { coderName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'coderName',
      message: 'Enter your coder name (used in branch names):',
      default: defaultName || undefined,
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Coder name is required'
        }
        // Validate it's kebab-case compatible
        const normalized = input.toLowerCase().replace(/[^a-z0-9-]/g, '')
        if (normalized !== input) {
          return 'Coder name must be lowercase letters, numbers, and hyphens only'
        }
        return true
      },
    },
  ])

  // Save preference to database
  saveCoderName(db, coderName)

  return coderName
}

/**
 * Get coder name, auto-detecting from GitHub if not set.
 * Priority: saved setting > GitHub username > git user.name > prompt
 */
export async function getOrPromptCoderName(db: Database.Database): Promise<string> {
  // If already set, return it
  const existing = getCoderName(db)
  if (existing) {
    return existing
  }

  // Try GitHub username first (most reliable for branch naming)
  const ghUsername = getGitHubUsername()
  if (ghUsername) {
    saveCoderName(db, ghUsername)
    return ghUsername
  }

  // Fall back to git user.name (normalized to kebab-case)
  const gitUserName = getGitUserName()
  if (gitUserName) {
    const normalized = gitUserName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (normalized) {
      saveCoderName(db, normalized)
      return normalized
    }
  }

  // Last resort - prompt user
  return promptCoderName(db)
}
