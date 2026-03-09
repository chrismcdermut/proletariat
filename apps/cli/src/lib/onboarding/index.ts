/**
 * Onboarding Module
 *
 * Agent-driven setup experience for Proletariat HQ.
 * Detects available agent runtimes (Claude Code, Codex) and offers
 * to spawn an AI agent that guides the user through HQ setup.
 */

import { execSync, spawn as nodeSpawn } from 'node:child_process'
import chalk from 'chalk'
import inquirer from 'inquirer'
import {
  shouldOutputJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../prompt-json.js'

// =============================================================================
// Runtime Detection
// =============================================================================

/**
 * A detected agent runtime with its metadata.
 */
export interface DetectedRuntime {
  /** Runtime identifier (e.g. 'claude-code', 'codex') */
  name: string
  /** Display name for the UI (e.g. 'Claude Code', 'Codex') */
  displayName: string
  /** CLI binary name on PATH */
  binary: string
  /** CLI version string (if detectable) */
  version?: string
}

/**
 * Known agent runtimes and their CLI binaries.
 * Detection order matters — first detected becomes the default.
 */
const KNOWN_RUNTIMES: Array<{
  name: string
  displayName: string
  binary: string
}> = [
  { name: 'claude-code', displayName: 'Claude Code', binary: 'claude' },
  { name: 'codex', displayName: 'Codex', binary: 'codex' },
]

/**
 * Check if a CLI binary is available on PATH.
 */
function isBinaryAvailable(binary: string): boolean {
  try {
    execSync(`command -v ${binary}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Try to get the version of a CLI binary.
 */
function getBinaryVersion(binary: string): string | undefined {
  try {
    return execSync(`${binary} --version`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
  } catch {
    return undefined
  }
}

/**
 * Detect all available agent runtimes on the system.
 *
 * Checks PATH for known CLI binaries (claude, codex) and returns
 * metadata for each one found.
 */
export function detectRuntimes(): DetectedRuntime[] {
  return KNOWN_RUNTIMES
    .filter(rt => isBinaryAvailable(rt.binary))
    .map(rt => ({
      name: rt.name,
      displayName: rt.displayName,
      binary: rt.binary,
      version: getBinaryVersion(rt.binary),
    }))
}

// =============================================================================
// Display
// =============================================================================

/**
 * Display detected runtimes to the user.
 */
export function displayRuntimeDetection(runtimes: DetectedRuntime[]): void {
  if (runtimes.length === 0) {
    console.log(chalk.gray('  No AI coding agents detected on PATH.\n'))
    return
  }

  console.log(chalk.blue('  Detected AI coding agents:\n'))
  for (const rt of runtimes) {
    const versionStr = rt.version ? chalk.gray(` (${rt.version})`) : ''
    console.log(chalk.green(`    ${rt.displayName}${versionStr}`))
  }
  console.log()
}

// =============================================================================
// Setup Mode Selection
// =============================================================================

/**
 * Setup mode options.
 */
export type SetupMode = 'agent-guided' | 'manual'

/**
 * Prompt user to choose between agent-guided and manual setup.
 *
 * @param runtimes - Available runtimes (determines which agent options to show)
 * @param jsonMode - If true, output JSON prompt instead of interactive UI
 * @param flags - Command flags for JSON metadata
 * @returns The chosen setup mode and optionally the selected runtime
 */
export async function promptSetupMode(
  runtimes: DetectedRuntime[],
  jsonMode: boolean,
  flags?: Record<string, unknown>,
): Promise<{ mode: SetupMode; runtime?: DetectedRuntime }> {
  const choices = [
    ...runtimes.map(rt => ({
      name: `Agent-guided setup with ${rt.displayName} (recommended)`,
      value: rt.name,
    })),
    { name: 'Manual setup (step-by-step prompts)', value: 'manual' },
  ]
  const message = 'How would you like to set up your headquarters?'

  if (jsonMode) {
    outputPromptAsJson(
      buildPromptConfig('list', 'setupMode', message, choices),
      createMetadata('init', flags ?? {}),
    )
    // outputPromptAsJson calls process.exit — unreachable
  }

  const { setupMode } = await inquirer.prompt([{
    type: 'list',
    name: 'setupMode',
    message,
    choices,
  }])

  if (setupMode === 'manual') {
    return { mode: 'manual' }
  }

  const selectedRuntime = runtimes.find(rt => rt.name === setupMode)
  return { mode: 'agent-guided', runtime: selectedRuntime }
}

// =============================================================================
// Setup Agent Prompt
// =============================================================================

/**
 * Build the setup prompt that will be given to the AI agent.
 *
 * The prompt instructs the agent to:
 * 1. Greet the user and explain the setup process
 * 2. Ask conversational questions about their HQ preferences
 * 3. Run `prlt init` with the appropriate flags to create the HQ
 */
export function buildSetupPrompt(): string {
  return `You are a setup assistant for Proletariat HQ — a tool for orchestrating AI coding agents across repositories.

Your job is to help the user set up their headquarters through a friendly conversation. Ask questions one at a time and keep it concise.

## Setup Steps

1. **HQ Name**: Ask for a name for their headquarters (company, project, or team name). Must be alphanumeric with hyphens/underscores only.

2. **Location**: Ask where to create the HQ directory. Default is ./{name}-hq in the current directory. The location must NOT be inside a git repository or another HQ.

3. **Repositories**: Ask if they have any git repositories to include. Accept paths or GitHub clone URLs (comma-separated). They can skip this and add repos later.

4. **Agents**: Ask how many AI coding agents they want (default: 10). Agent names are auto-generated from a theme. They can skip and add agents later.

5. **PMO**: Ask if they want a project management board (recommended, default: yes).

## Running the Setup

Once you have all the information, run the init command:

\`\`\`bash
prlt init --json --name <name> [--path <path>] [--agents <comma-separated-names>] [--repos <comma-separated-paths>] [--pmo | --no-pmo]
\`\`\`

Note: If the user wants auto-generated agents, you don't need to pass --agents. The default theme will create them.

## Important Rules

- Keep responses SHORT and conversational
- Ask one question at a time
- Provide sensible defaults
- If the user seems unsure, suggest defaults and move forward
- After running \`prlt init\`, show the user what was created and suggest next steps:
  - \`cd <hq-path>\` to navigate to the HQ
  - \`prlt agent list\` to see agents
  - \`prlt ticket create\` to create a ticket
  - \`prlt work start\` to start working on a ticket with an agent
`
}

// =============================================================================
// Agent Spawning
// =============================================================================

/**
 * Arguments for spawning a setup agent based on runtime type.
 */
function getSpawnArgs(runtime: DetectedRuntime, prompt: string): string[] {
  switch (runtime.name) {
    case 'claude-code':
      // Claude Code: pass prompt directly, with --dangerously-skip-permissions
      // for the init command which only creates directories and files
      return ['--print', '--dangerously-skip-permissions', prompt]
    case 'codex':
      // Codex: pass prompt as positional arg with --yolo for autonomous setup
      return ['--yolo', prompt]
    default:
      return [prompt]
  }
}

/**
 * Spawn an AI agent in the foreground to guide the user through setup.
 *
 * The agent runs in the current terminal with inherited stdio so it can
 * interact with the user directly.
 *
 * @param runtime - The detected runtime to use
 * @returns Promise that resolves when the agent exits
 */
export function spawnSetupAgent(runtime: DetectedRuntime): Promise<{ exitCode: number }> {
  const prompt = buildSetupPrompt()
  const args = getSpawnArgs(runtime, prompt)

  return new Promise((resolve, reject) => {
    const child = nodeSpawn(runtime.binary, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env },
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${runtime.displayName}: ${err.message}`))
    })

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0 })
    })
  })
}
