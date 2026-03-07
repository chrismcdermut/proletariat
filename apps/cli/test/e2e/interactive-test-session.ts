/**
 * InteractiveTestSession - A test harness for exercising interactive CLI menus
 * using tmux send-keys and capture-pane.
 *
 * This tests what humans actually see — the interactive menu navigation, prompts,
 * styled output, arrow-key selection, etc. — which the existing --json/--machine
 * tests completely skip.
 *
 * Architecture:
 *   - Creates a tmux session with a bash shell
 *   - Sends keystrokes via `tmux send-keys`
 *   - Captures rendered output via `tmux capture-pane -p`
 *   - Polls output until it stabilizes (content stops changing)
 *   - Provides assertion helpers for verifying screen content
 *
 * When Docker is available (CI), tests can optionally run inside a container
 * for full isolation. When Docker is unavailable (devcontainer), tests use
 * the local tmux + prlt directly.
 */

import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';

/**
 * Configuration for an interactive test session.
 */
export interface InteractiveSessionConfig {
  /** Terminal width in columns (default: 120) */
  width?: number;
  /** Terminal height in rows (default: 40) */
  height?: number;
  /** Environment variables to set in the session */
  env?: Record<string, string>;
  /** Working directory for the session */
  cwd?: string;
  /** Default timeout for waitForOutput in ms (default: 10000) */
  defaultTimeout?: number;
  /** Poll interval for waitForOutput in ms (default: 250) */
  pollInterval?: number;
}

/**
 * Result of a screen capture, with helper methods.
 */
export interface ScreenCapture {
  /** Raw terminal content as a single string */
  raw: string;
  /** Terminal content split into lines */
  lines: string[];
  /** Timestamp of capture */
  timestamp: number;
}

/**
 * Wraps a tmux session for interactive CLI testing.
 *
 * Usage:
 *   const session = new InteractiveTestSession({ env: { PRLT_HQ_PATH: '/hq' } });
 *   await session.start();
 *   await session.sendCommand('prlt ticket');
 *   await session.waitForOutput('Ticket Operations');
 *   const screen = session.getScreen();
 *   session.assertScreenContains('Create new ticket');
 *   session.assertScreenContains('List all tickets');
 *   await session.sendKeys('Down', 'Down', 'Enter');
 *   await session.stop();
 */
export class InteractiveTestSession {
  private sessionName: string;
  private config: Required<InteractiveSessionConfig>;
  private started = false;

  constructor(config: InteractiveSessionConfig = {}) {
    // Generate a unique session name to avoid collisions
    const id = crypto.randomBytes(4).toString('hex');
    this.sessionName = `prlt-test-${id}`;

    this.config = {
      width: config.width ?? 120,
      height: config.height ?? 120,
      env: config.env ?? {},
      cwd: config.cwd ?? process.cwd(),
      defaultTimeout: config.defaultTimeout ?? 10000,
      pollInterval: config.pollInterval ?? 250,
    };
  }

  /**
   * Start the tmux session with a clean bash shell.
   */
  start(): void {
    if (this.started) {
      throw new Error('Session already started');
    }

    // Build environment export commands
    const envExports = Object.entries({
      TERM: 'xterm-256color',
      PRLT_SKIP_NEW_VERSION_CHECK: 'true',
      ...this.config.env,
    })
      .map(([k, v]) => `export ${k}=${this.shellEscape(v)}`)
      .join(' && ');

    // Create tmux session with bash (no rc files for clean env)
    // BASH_SILENCE_DEPRECATION_WARNING suppresses macOS "default shell is now zsh" warning
    // which is emitted by Apple's patched bash binary before profile scripts run.
    this.tmuxExec(
      `new-session -d -s ${this.sessionName} -x ${this.config.width} -y ${this.config.height} "BASH_SILENCE_DEPRECATION_WARNING=1 bash --norc --noprofile"`
    );

    // Force the window to the requested dimensions — tmux may ignore -x/-y
    // when other clients are attached to the server.
    this.tmuxExec(
      `resize-window -t ${this.sessionName} -x ${this.config.width} -y ${this.config.height}`
    );

    this.started = true;

    // Wait for bash to initialize
    this.sleep(500);

    // Set environment variables
    if (envExports) {
      this.tmuxSendKeys(envExports);
      this.tmuxSendKeys('Enter');
      this.sleep(300);
    }

    // Set working directory if specified
    if (this.config.cwd) {
      this.tmuxSendKeys(`cd ${this.shellEscape(this.config.cwd)}`);
      this.tmuxSendKeys('Enter');
      this.sleep(300);
    }

    // Clear the screen to remove any shell init output (env exports, cd, etc.)
    this.tmuxSendKeys('clear');
    this.tmuxSendKeys('Enter');
    this.sleep(300);
  }

  /**
   * Stop and destroy the tmux session.
   */
  stop(): void {
    if (!this.started) return;

    try {
      this.tmuxExec(`kill-session -t ${this.sessionName}`);
    } catch {
      // Session may already be dead
    }
    this.started = false;
  }

  /**
   * Send a full command string (types it out and presses Enter).
   */
  sendCommand(command: string): void {
    this.ensureStarted();
    this.tmuxSendKeys(command);
    this.tmuxSendKeys('Enter');
  }

  /**
   * Send individual keystrokes to the terminal.
   * Supports special keys: Up, Down, Left, Right, Enter, Escape, Tab,
   * C-c (Ctrl+C), C-d (Ctrl+D), Space, BSpace (Backspace).
   *
   * @param keys - One or more key names to send sequentially
   */
  send(...keys: string[]): void {
    this.ensureStarted();
    for (const key of keys) {
      this.tmuxSendKeys(key);
      // Small delay between keystrokes to allow processing
      this.sleep(100);
    }
  }

  /**
   * Send literal text input (for typing into prompts).
   * Unlike send(), this sends the text as literal characters.
   */
  type(text: string): void {
    this.ensureStarted();
    // Use -l flag to send literal text (no key name interpretation)
    this.tmuxExec(`send-keys -t ${this.sessionName} -l ${this.shellEscape(text)}`);
  }

  /**
   * Capture the current terminal screen content.
   */
  getScreen(): ScreenCapture {
    this.ensureStarted();
    const raw = this.capturePane();
    return {
      raw,
      lines: raw.split('\n'),
      timestamp: Date.now(),
    };
  }

  /**
   * Wait for a specific pattern to appear in the terminal output.
   * Polls capture-pane until the pattern is found or timeout expires.
   *
   * @param pattern - String or RegExp to search for in terminal output
   * @param timeout - Max wait time in ms (default: session's defaultTimeout)
   * @returns The screen capture that matched
   * @throws Error if pattern not found within timeout
   */
  waitForOutput(pattern: string | RegExp, timeout?: number): ScreenCapture {
    this.ensureStarted();
    const maxWait = timeout ?? this.config.defaultTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const screen = this.getScreen();
      if (this.matchesPattern(screen.raw, pattern)) {
        return screen;
      }
      this.sleep(this.config.pollInterval);
    }

    // Final capture for error message
    const finalScreen = this.getScreen();
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    throw new Error(
      `Timed out after ${maxWait}ms waiting for pattern: "${patternStr}"\n` +
      `Current screen content:\n${finalScreen.raw}`
    );
  }

  /**
   * Wait for the terminal output to stabilize (stop changing).
   * Useful after sending a command, to wait for all output to render.
   *
   * @param stableFor - How long content must remain unchanged in ms (default: 500)
   * @param timeout - Max wait time in ms (default: session's defaultTimeout)
   * @returns The stable screen capture
   */
  waitForStable(stableFor?: number, timeout?: number): ScreenCapture {
    this.ensureStarted();
    const stableDuration = stableFor ?? 500;
    const maxWait = timeout ?? this.config.defaultTimeout;
    const startTime = Date.now();
    let lastContent = '';
    let lastChangeTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const screen = this.getScreen();
      const currentContent = screen.raw.trim();

      if (currentContent !== lastContent) {
        lastContent = currentContent;
        lastChangeTime = Date.now();
      } else if (Date.now() - lastChangeTime >= stableDuration) {
        return screen;
      }

      this.sleep(this.config.pollInterval);
    }

    return this.getScreen();
  }

  /**
   * Assert that the current screen contains the given text.
   * @throws Error if text is not found on screen
   */
  assertScreenContains(text: string): void {
    const screen = this.getScreen();
    if (!screen.raw.includes(text)) {
      throw new Error(
        `Expected screen to contain: "${text}"\n` +
        `Actual screen content:\n${screen.raw}`
      );
    }
  }

  /**
   * Assert that the current screen does NOT contain the given text.
   * @throws Error if text IS found on screen
   */
  assertScreenNotContains(text: string): void {
    const screen = this.getScreen();
    if (screen.raw.includes(text)) {
      throw new Error(
        `Expected screen NOT to contain: "${text}"\n` +
        `Actual screen content:\n${screen.raw}`
      );
    }
  }

  /**
   * Assert that the current screen matches a pattern.
   * @throws Error if pattern is not found on screen
   */
  assertScreenMatches(pattern: RegExp): void {
    const screen = this.getScreen();
    if (!pattern.test(screen.raw)) {
      throw new Error(
        `Expected screen to match: ${pattern}\n` +
        `Actual screen content:\n${screen.raw}`
      );
    }
  }

  /**
   * Assert that a specific item is currently highlighted (has the ❯ indicator).
   */
  assertSelected(itemText: string): void {
    const screen = this.getScreen();
    // inquirer uses ❯ to indicate the selected item
    const selectedLine = screen.lines.find(
      (line) => line.includes('❯') && line.includes(itemText)
    );
    if (!selectedLine) {
      throw new Error(
        `Expected "${itemText}" to be selected (❯ indicator)\n` +
        `Actual screen content:\n${screen.raw}`
      );
    }
  }

  /**
   * Reset the terminal for the next test.
   * Sends Ctrl+C to cancel any running command, then clears the screen.
   */
  reset(): void {
    this.ensureStarted();
    // Cancel any running process
    this.tmuxSendKeys('C-c');
    this.sleep(500);
    // Send another Ctrl+C in case the first was consumed
    this.tmuxSendKeys('C-c');
    this.sleep(500);
    // Clear the terminal
    this.tmuxSendKeys('clear');
    this.tmuxSendKeys('Enter');
    this.sleep(300);
  }

  /**
   * Get the tmux session name (for debugging).
   */
  getSessionName(): string {
    return this.sessionName;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureStarted(): void {
    if (!this.started) {
      throw new Error('Session not started. Call start() first.');
    }
  }

  private tmuxExec(cmd: string): string {
    try {
      return execSync(`tmux ${cmd}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`tmux command failed: tmux ${cmd}\n${msg}`);
    }
  }

  private tmuxSendKeys(keys: string): void {
    // For special keys and Ctrl combos, don't quote them
    // For text input, quote it to preserve spaces
    const isSpecialKey = /^(Up|Down|Left|Right|Enter|Escape|Tab|Space|BSpace|C-[a-z]|M-[a-z])$/.test(keys);

    if (isSpecialKey) {
      this.tmuxExec(`send-keys -t ${this.sessionName} ${keys}`);
    } else {
      // Send as literal text to avoid key interpretation issues
      this.tmuxExec(`send-keys -t ${this.sessionName} ${this.shellEscape(keys)}`);
    }
  }

  private capturePane(): string {
    return this.tmuxExec(`capture-pane -t ${this.sessionName} -p`);
  }

  private matchesPattern(text: string, pattern: string | RegExp): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(text);
    }
    return text.includes(pattern);
  }

  private shellEscape(str: string): string {
    // Use single quotes for shell escaping, handling embedded single quotes
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  private sleep(ms: number): void {
    execSync(`sleep ${ms / 1000}`, { timeout: ms + 5000 });
  }
}
