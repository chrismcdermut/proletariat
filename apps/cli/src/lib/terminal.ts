/**
 * Terminal utilities for controlling terminal behavior.
 *
 * Provides ANSI escape sequence utilities for:
 * - Setting terminal tab/window titles
 * - Future: clearing screen, notifications, etc.
 */

/**
 * Generate shell commands to set the terminal tab/window title.
 * Uses ANSI escape sequences that work across most terminal emulators.
 *
 * \033]0;Title\007 - Sets both window and tab title (most compatible)
 * \033]1;Title\007 - Sets tab title only (iTerm2, some others)
 * \033]2;Title\007 - Sets window title only
 *
 * @param title - The title to set
 * @returns Shell commands to execute
 */
export function getSetTitleCommands(title: string): string {
  // Escape any special characters in the title
  const safeTitle = title.replace(/[\\'"]/g, '')
  return `
# Set terminal tab/window title
echo -ne "\\033]0;${safeTitle}\\007"
echo -ne "\\033]1;${safeTitle}\\007"
`
}

/**
 * Set the terminal title directly using ANSI escape sequences.
 * Writes directly to stdout.
 *
 * @param title - The title to set (empty string to reset)
 */
export function setTerminalTitle(title: string): void {
  // Escape any special characters
  const safeTitle = title.replace(/[\\'"]/g, '')

  // OSC 0 - Set both window and tab title (most compatible)
  process.stdout.write(`\x1b]0;${safeTitle}\x07`)

  // OSC 1 - Set tab title (iTerm2 and others)
  process.stdout.write(`\x1b]1;${safeTitle}\x07`)
}

/**
 * Reset the terminal title to default (shell will set its own).
 * This sends an empty title which most terminals interpret as "use default".
 */
export function resetTerminalTitle(): void {
  setTerminalTitle('')
}
