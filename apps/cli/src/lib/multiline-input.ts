/**
 * Multi-line text input utility for CLI.
 *
 * Provides inline TTY text input without opening external editors.
 * Handles paste safely, supports cursor navigation, and provides
 * clear visual feedback.
 *
 * Usage:
 * ```typescript
 * const text = await multiLineInput({
 *   message: 'Enter description:',
 *   default: 'Existing content...',
 * });
 * ```
 */

import * as readline from 'node:readline';
import chalk from 'chalk';
import { isNonTTY } from './prompt-json.js';

/**
 * Options for multiLineInput
 */
export interface MultiLineInputOptions {
  /** Prompt message displayed above the input area */
  message: string;
  /** Default/initial content to populate the input with */
  default?: string;
  /** Hint text shown below the input area (e.g., key bindings) */
  hint?: string;
  /** Whether input is required (empty not allowed) */
  required?: boolean;
  /** Validation function - returns true if valid, or error message */
  validate?: (value: string) => boolean | string;
}

/**
 * Result of multiLineInput
 */
export interface MultiLineInputResult {
  /** The entered text */
  value: string;
  /** Whether input was cancelled (Ctrl+C) */
  cancelled: boolean;
}

// ANSI escape codes for terminal control
const ESC = '\u001B';
const CSI = `${ESC}[`;

// Control characters
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007F';
const DELETE = '\u001B[3~';
const ENTER = '\r';
const NEWLINE = '\n';

// Arrow keys (CSI sequences)
const ARROW_UP = `${CSI}A`;
const ARROW_DOWN = `${CSI}B`;
const ARROW_RIGHT = `${CSI}C`;
const ARROW_LEFT = `${CSI}D`;
const HOME = `${CSI}H`;
const END = `${CSI}F`;

/**
 * Clear the current line and move cursor to beginning
 */
function clearLine(): void {
  process.stdout.write(`${CSI}2K${CSI}G`);
}

/**
 * Move cursor up N lines
 */
function moveUp(n: number): void {
  if (n > 0) {
    process.stdout.write(`${CSI}${n}A`);
  }
}

/**
 * Move cursor down N lines
 */
function moveDown(n: number): void {
  if (n > 0) {
    process.stdout.write(`${CSI}${n}B`);
  }
}

/**
 * Move cursor to specific column
 */
function moveToColumn(col: number): void {
  process.stdout.write(`${CSI}${col + 1}G`);
}

/**
 * Show cursor
 */
function showCursor(): void {
  process.stdout.write(`${CSI}?25h`);
}

/**
 * Collect multi-line input from the user with an inline TTY editor.
 *
 * Features:
 * - Arrow key navigation
 * - Backspace/delete
 * - Copy-paste handling (escapes special characters)
 * - Ctrl+D to finish, Ctrl+C to cancel
 * - Pre-populated content support
 * - Real-time visual feedback
 *
 * @param options Input options
 * @returns The entered text and cancellation status
 */
export async function multiLineInput(options: MultiLineInputOptions): Promise<MultiLineInputResult> {
  const {
    message,
    default: defaultValue = '',
    hint = 'Ctrl+D to finish, Ctrl+C to cancel',
    required = false,
    validate,
  } = options;

  // If not a TTY, return the default value
  if (isNonTTY()) {
    return { value: defaultValue, cancelled: false };
  }

  return new Promise((resolve) => {
    // Initialize state
    const lines: string[] = defaultValue.split('\n');
    let cursorLine = lines.length - 1;
    let cursorCol = lines[cursorLine].length;
    let renderedLineCount = 0;
    let inputBuffer = ''; // Buffer for multi-byte sequences

    // Set up raw mode
    const wasRaw = process.stdin.isRaw;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Render the input area
    function render(): void {
      // Move up to the start of our rendered area
      if (renderedLineCount > 0) {
        moveUp(renderedLineCount);
      }
      clearLine();

      // Print message
      process.stdout.write(chalk.cyan(message) + '\n');

      // Print hint
      process.stdout.write(chalk.dim(hint) + '\n');

      // Print border (guard against very small terminal widths)
      const termWidth = process.stdout.columns || 80;
      const borderWidth = Math.max(1, Math.min(termWidth - 4, 76));
      process.stdout.write(chalk.dim('┌' + '─'.repeat(borderWidth) + '┐') + '\n');

      // Print lines with line numbers
      const displayLines = lines.length > 0 ? lines : [''];
      for (let i = 0; i < displayLines.length; i++) {
        clearLine();
        const lineNum = chalk.dim(`${String(i + 1).padStart(2)} │`);
        const lineContent = displayLines[i];
        process.stdout.write(`${lineNum} ${lineContent}\n`);
      }

      // Print bottom border
      process.stdout.write(chalk.dim('└' + '─'.repeat(borderWidth) + '┘') + '\n');

      // Calculate total rendered lines: message + hint + top border + content lines + bottom border
      renderedLineCount = 1 + 1 + 1 + displayLines.length + 1;

      // Position cursor
      // Move up from current position to the correct line
      const linesFromBottom = displayLines.length - cursorLine;
      moveUp(linesFromBottom); // Go to the correct content line (accounting for bottom border)

      // Move to correct column (line number takes 5 chars: "NN │ ")
      moveToColumn(5 + cursorCol);
    }

    // Handle cleanup
    function cleanup(): void {
      process.stdin.setRawMode(wasRaw || false);
      process.stdin.pause();
      showCursor();

      // Move to end of rendered area
      const displayLines = lines.length > 0 ? lines : [''];
      const linesFromBottom = displayLines.length - cursorLine;
      moveDown(linesFromBottom + 1); // +1 for bottom border
      clearLine();
    }

    // Handle input
    function handleInput(chunk: Buffer): void {
      const str = chunk.toString('utf8');

      // Append to buffer for handling multi-byte sequences
      inputBuffer += str;

      // Process buffer character by character
      while (inputBuffer.length > 0) {
        // Check for escape sequences
        if (inputBuffer.startsWith(ESC)) {
          // Wait for more data if sequence might be incomplete
          if (inputBuffer.length < 3 && inputBuffer !== ESC) {
            // Could be start of a sequence, wait for more
            if (inputBuffer.length === 1) {
              // Just ESC by itself, treat as cancel after timeout
              setTimeout(() => {
                if (inputBuffer === ESC) {
                  inputBuffer = '';
                  // ESC key pressed - ignore
                }
              }, 50);
              return;
            }
            return;
          }

          // Handle arrow keys and other sequences
          if (inputBuffer.startsWith(ARROW_UP)) {
            inputBuffer = inputBuffer.slice(3);
            if (cursorLine > 0) {
              cursorLine--;
              cursorCol = Math.min(cursorCol, lines[cursorLine].length);
            }
            render();
            continue;
          }

          if (inputBuffer.startsWith(ARROW_DOWN)) {
            inputBuffer = inputBuffer.slice(3);
            if (cursorLine < lines.length - 1) {
              cursorLine++;
              cursorCol = Math.min(cursorCol, lines[cursorLine].length);
            }
            render();
            continue;
          }

          if (inputBuffer.startsWith(ARROW_LEFT)) {
            inputBuffer = inputBuffer.slice(3);
            if (cursorCol > 0) {
              cursorCol--;
            } else if (cursorLine > 0) {
              cursorLine--;
              cursorCol = lines[cursorLine].length;
            }
            render();
            continue;
          }

          if (inputBuffer.startsWith(ARROW_RIGHT)) {
            inputBuffer = inputBuffer.slice(3);
            if (cursorCol < lines[cursorLine].length) {
              cursorCol++;
            } else if (cursorLine < lines.length - 1) {
              cursorLine++;
              cursorCol = 0;
            }
            render();
            continue;
          }

          if (inputBuffer.startsWith(HOME)) {
            inputBuffer = inputBuffer.slice(3);
            cursorCol = 0;
            render();
            continue;
          }

          if (inputBuffer.startsWith(END)) {
            inputBuffer = inputBuffer.slice(3);
            cursorCol = lines[cursorLine].length;
            render();
            continue;
          }

          if (inputBuffer.startsWith(DELETE)) {
            inputBuffer = inputBuffer.slice(4);
            if (cursorCol < lines[cursorLine].length) {
              lines[cursorLine] = lines[cursorLine].slice(0, cursorCol) + lines[cursorLine].slice(cursorCol + 1);
            } else if (cursorLine < lines.length - 1) {
              // Join with next line
              lines[cursorLine] += lines[cursorLine + 1];
              lines.splice(cursorLine + 1, 1);
            }
            render();
            continue;
          }

          // Unknown escape sequence - skip ESC and continue
          inputBuffer = inputBuffer.slice(1);
          continue;
        }

        // Handle control characters
        const char = inputBuffer[0];
        inputBuffer = inputBuffer.slice(1);

        if (char === CTRL_C) {
          cleanup();
          resolve({ value: '', cancelled: true });
          return;
        }

        if (char === CTRL_D) {
          const text = lines.join('\n').trim();

          // Validate if required
          if (required && text.length === 0) {
            // Show error and continue - must restore raw mode for input to work
            process.stdout.write(chalk.red('Input is required. Please enter some text.') + '\n');
            renderedLineCount = 0;
            render();
            return;
          }

          if (validate) {
            const result = validate(text);
            if (result !== true) {
              // Show error and continue - keep raw mode active
              process.stdout.write(chalk.red(typeof result === 'string' ? result : 'Invalid input') + '\n');
              renderedLineCount = 0;
              render();
              return;
            }
          }

          cleanup();
          resolve({ value: text, cancelled: false });
          return;
        }

        if (char === BACKSPACE || char === '\b') {
          if (cursorCol > 0) {
            lines[cursorLine] = lines[cursorLine].slice(0, cursorCol - 1) + lines[cursorLine].slice(cursorCol);
            cursorCol--;
          } else if (cursorLine > 0) {
            // Join with previous line
            cursorCol = lines[cursorLine - 1].length;
            lines[cursorLine - 1] += lines[cursorLine];
            lines.splice(cursorLine, 1);
            cursorLine--;
          }
          render();
          continue;
        }

        if (char === ENTER || char === NEWLINE) {
          // Split line at cursor
          const before = lines[cursorLine].slice(0, cursorCol);
          const after = lines[cursorLine].slice(cursorCol);
          lines[cursorLine] = before;
          lines.splice(cursorLine + 1, 0, after);
          cursorLine++;
          cursorCol = 0;
          render();
          continue;
        }

        // Handle regular characters (including paste)
        // Filter out non-printable characters except tab
        if (char === '\t' || (char >= ' ' && char <= '~') || char.charCodeAt(0) > 127) {
          // Insert character at cursor position
          lines[cursorLine] = lines[cursorLine].slice(0, cursorCol) + char + lines[cursorLine].slice(cursorCol);
          cursorCol++;
          render();
        }
      }
    }

    // Initial render
    render();

    // Listen for input
    process.stdin.on('data', handleInput);

    // Cleanup listener on resolve
    const originalResolve = resolve;
    resolve = (result) => {
      process.stdin.removeListener('data', handleInput);
      originalResolve(result);
    };
  });
}

/**
 * Convenience wrapper that returns just the value string.
 * Throws if cancelled.
 */
export async function promptMultiLine(options: MultiLineInputOptions): Promise<string> {
  const result = await multiLineInput(options);
  if (result.cancelled) {
    throw new Error('Input cancelled');
  }
  return result.value;
}

/**
 * Integration with FlagResolver - creates a prompt-compatible function
 */
export function createMultiLinePrompt(
  message: string,
  defaultValue?: string,
  hint?: string
): () => Promise<string> {
  return async () => {
    const result = await multiLineInput({
      message,
      default: defaultValue,
      hint,
    });
    if (result.cancelled) {
      throw new Error('Input cancelled');
    }
    return result.value;
  };
}
