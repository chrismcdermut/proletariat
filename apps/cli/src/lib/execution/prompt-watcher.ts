/**
 * Prompt Watcher — Auto-dismiss third-party plugin onboarding prompts
 *
 * Monitors tmux pane output during the first N seconds after agent spawn
 * to detect and auto-dismiss known interactive prompts (e.g. Vercel plugin
 * telemetry, Claude Code sensitive-file write permission).
 *
 * PRLT-1281: Prevents agents from getting stuck on plugin first-run dialogs.
 */

import { execSync } from 'node:child_process'
import { captureTmuxPane } from './session-utils.js'

// =============================================================================
// Types
// =============================================================================

/** Policy for what to do when a prompt is matched. */
export type DismissAction = 'decline' | 'approve_always' | 'approve' | 'escalate'

/** A known prompt pattern and its auto-dismiss response. */
export interface PromptPattern {
  /** Human-readable name for logging. */
  name: string
  /** Required header text that must appear in the pane output. */
  headerMatch: string
  /** The cursor marker that indicates an interactive menu is active. */
  cursorMarker: string
  /** What action to take when matched. */
  action: DismissAction
  /**
   * The option text to select. For numbered menus, this is matched against
   * the menu items to find the correct number key to send.
   */
  preferredOption: string
  /**
   * Fallback option text if preferredOption is not found in the menu.
   * Used for "Always allow" → fallback to "Yes" scenarios.
   */
  fallbackOption?: string
}

/** Result of a prompt dismissal attempt. */
export interface DismissResult {
  /** The pattern that matched. */
  pattern: PromptPattern
  /** The actual text that was matched in the pane output. */
  matchedText: string
  /** The answer that was sent. */
  selectedAnswer: string
  /** Whether the dismissal was successful (keystroke sent without error). */
  success: boolean
  /** Error message if dismissal failed. */
  error?: string
}

/** Result of an escalation (unknown prompt detected). */
export interface EscalationResult {
  /** The pane content that triggered escalation. */
  paneContent: string
  /** Why escalation was triggered. */
  reason: string
}

/** Callback for logging auto-dismiss events. */
export type DismissLogger = (result: DismissResult) => void

/** Callback for escalating unknown prompts. */
export type EscalationHandler = (result: EscalationResult) => void

// =============================================================================
// Known Prompt Patterns
// =============================================================================

/**
 * Registry of known plugin onboarding prompts.
 * Start narrow (exact strings) and broaden as more prompts are cataloged.
 */
export const KNOWN_PROMPT_PATTERNS: PromptPattern[] = [
  {
    name: 'vercel-plugin-telemetry',
    headerMatch: 'The Vercel plugin collects anonymous usage data',
    cursorMarker: '❯',
    action: 'decline',
    preferredOption: 'No thanks',
  },
  {
    name: 'claude-sensitive-file-permission',
    headerMatch: 'Claude requested permissions to edit',
    cursorMarker: '❯',
    action: 'approve_always',
    preferredOption: 'Yes, and always allow access to .claude/',
    fallbackOption: 'Yes',
  },
  // PRLT-1322: Claude Code first-run theme picker. We pre-seed
  // `/home/node/.claude.json` with `hasCompletedOnboarding: true` inside
  // containers, but this pattern is a safety net for any container that
  // still manages to hit the prompt (e.g. reused image without seed, or
  // Claude Code rewriting the file before reading it).
  {
    name: 'claude-theme-selection',
    headerMatch: 'Choose the text style that looks best',
    cursorMarker: '❯',
    action: 'approve',
    preferredOption: 'Dark mode',
    fallbackOption: '1',
  },
  // PRLT-1322: Claude Code's "shell integration" onboarding prompt.
  {
    name: 'claude-shell-integration',
    headerMatch: 'shell integration',
    cursorMarker: '❯',
    action: 'decline',
    preferredOption: 'No',
    fallbackOption: 'Skip',
  },
  // PRLT-1322: Claude Code's workspace trust dialog.
  {
    name: 'claude-workspace-trust',
    headerMatch: 'Do you trust',
    cursorMarker: '❯',
    action: 'approve',
    preferredOption: 'Yes, proceed',
    fallbackOption: 'Yes',
  },
]

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Check if pane output contains a genuine interactive prompt.
 * Requires BOTH the header text AND the cursor marker to be present,
 * preventing false positives from normal numbered lists in output.
 */
export function detectPrompt(paneContent: string): { pattern: PromptPattern; matchedText: string } | null {
  for (const pattern of KNOWN_PROMPT_PATTERNS) {
    if (
      paneContent.includes(pattern.headerMatch) &&
      paneContent.includes(pattern.cursorMarker)
    ) {
      return { pattern, matchedText: pattern.headerMatch }
    }
  }
  return null
}

/**
 * Check if pane output contains an unknown interactive prompt.
 * An unknown prompt has the cursor marker (❯) with a numbered list
 * but does NOT match any known pattern's header text.
 *
 * We look for lines that start with the cursor marker followed by a number,
 * indicating an active numbered menu that we don't recognize.
 */
export function detectUnknownPrompt(paneContent: string): boolean {
  // Must have the interactive cursor marker
  if (!paneContent.includes('❯')) return false

  // Must have numbered menu items (e.g. "❯ 1." or "  2.")
  const hasNumberedMenu = /❯\s+\d+\./m.test(paneContent) && /\s+\d+\.\s+\S/m.test(paneContent)
  if (!hasNumberedMenu) return false

  // Must NOT match any known pattern (those are handled by detectPrompt)
  const knownMatch = detectPrompt(paneContent)
  if (knownMatch) return false

  return true
}

/**
 * Find the menu option number for a given option text.
 * Parses numbered menu items like "  2. No thanks" and returns the number key.
 */
export function findMenuOptionKey(paneContent: string, optionText: string): string | null {
  // Match lines like "❯ 1. Share prompts" or "  2. No thanks"
  const menuLineRegex = /[❯\s]+(\d+)\.\s+(.+)/g
  let match
  while ((match = menuLineRegex.exec(paneContent)) !== null) {
    const [, number, text] = match
    if (text.trim().toLowerCase().startsWith(optionText.toLowerCase())) {
      return number
    }
  }
  return null
}

/**
 * Determine the key to send for a given prompt pattern match.
 * Returns the number key for the preferred (or fallback) option.
 */
export function resolveKeyToSend(paneContent: string, pattern: PromptPattern): { key: string; optionText: string } | null {
  // Try preferred option first
  const preferredKey = findMenuOptionKey(paneContent, pattern.preferredOption)
  if (preferredKey) {
    return { key: preferredKey, optionText: pattern.preferredOption }
  }

  // Try fallback option
  if (pattern.fallbackOption) {
    const fallbackKey = findMenuOptionKey(paneContent, pattern.fallbackOption)
    if (fallbackKey) {
      return { key: fallbackKey, optionText: pattern.fallbackOption }
    }
  }

  return null
}

// =============================================================================
// Keystroke Sending
// =============================================================================

/**
 * Send a menu selection keystroke to a tmux session.
 * Sends the number key followed by Enter to select the option.
 */
export function sendMenuSelection(sessionId: string, key: string, containerId?: string): void {
  const sendKeyCmd = `tmux send-keys -t "${sessionId}" "${key}"`
  const sendEnterCmd = `tmux send-keys -t "${sessionId}" Enter`

  if (containerId) {
    execSync(
      `docker exec ${containerId} bash -c '${sendKeyCmd}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    )
    execSync('sleep 0.2', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(
      `docker exec ${containerId} bash -c '${sendEnterCmd}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    )
  } else {
    execSync(sendKeyCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    execSync('sleep 0.2', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(sendEnterCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
  }
}

// =============================================================================
// Prompt Watcher
// =============================================================================

export interface PromptWatcherOptions {
  /** How long to watch for prompts (ms). Default: 60000 (60s). */
  watchDurationMs?: number
  /** How often to poll pane output (ms). Default: 3000 (3s). */
  pollIntervalMs?: number
  /** Number of scrollback lines to capture. Default: 50. */
  captureLines?: number
  /** Container ID for container-based sessions. */
  containerId?: string
  /** Callback for logging auto-dismiss events. */
  onDismiss?: DismissLogger
  /** Callback for escalating unknown prompts. */
  onEscalate?: EscalationHandler
  /** Logging function. */
  log?: (msg: string) => void
}

/**
 * Start watching a tmux session for interactive prompts.
 * Runs in the background (non-blocking) for the configured duration.
 *
 * Returns a cleanup function to stop watching early.
 */
export function startPromptWatcher(
  sessionId: string,
  options: PromptWatcherOptions = {},
): () => void {
  const {
    watchDurationMs = 60_000,
    pollIntervalMs = 3_000,
    captureLines = 50,
    containerId,
    onDismiss,
    onEscalate,
    log = () => {},
  } = options

  let stopped = false
  // Track patterns already handled to avoid re-sending keystrokes
  const dismissedPatterns = new Set<string>()
  let escalated = false

  const poll = (): void => {
    if (stopped) return

    try {
      const paneContent = captureTmuxPane(sessionId, captureLines, containerId)
      if (!paneContent) return

      // Check for known prompts first
      const detection = detectPrompt(paneContent)
      if (detection && !dismissedPatterns.has(detection.pattern.name)) {
        const { pattern, matchedText } = detection

        // Resolve which key to send
        const resolution = resolveKeyToSend(paneContent, pattern)
        if (resolution) {
          log(`[prompt-watcher] Auto-dismissing "${pattern.name}" with option "${resolution.optionText}"`)

          try {
            sendMenuSelection(sessionId, resolution.key, containerId)
            dismissedPatterns.add(pattern.name)

            const result: DismissResult = {
              pattern,
              matchedText,
              selectedAnswer: resolution.optionText,
              success: true,
            }
            onDismiss?.(result)
          } catch (error) {
            const result: DismissResult = {
              pattern,
              matchedText,
              selectedAnswer: resolution.optionText,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }
            onDismiss?.(result)
            log(`[prompt-watcher] Failed to dismiss "${pattern.name}": ${result.error}`)
          }
        }

        return // Don't check for unknown prompts in the same poll cycle
      }

      // Check for unknown prompts (escalate, don't auto-answer)
      if (!escalated && detectUnknownPrompt(paneContent)) {
        escalated = true
        log('[prompt-watcher] Unknown interactive prompt detected — escalating')
        onEscalate?.({
          paneContent,
          reason: 'Unknown interactive prompt with numbered menu detected during startup window',
        })
      }
    } catch {
      // Polling errors are non-fatal — session may have ended
    }
  }

  // Start polling
  const intervalId = setInterval(poll, pollIntervalMs)

  // Run first check immediately
  poll()

  // Auto-stop after watch duration
  const timeoutId = setTimeout(() => {
    stopped = true
    clearInterval(intervalId)
    log(`[prompt-watcher] Watch period ended for session "${sessionId}"`)
  }, watchDurationMs)

  // Return cleanup function
  return () => {
    stopped = true
    clearInterval(intervalId)
    clearTimeout(timeoutId)
  }
}
