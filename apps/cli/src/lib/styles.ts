/**
 * CLI Output Style Guide
 *
 * Centralized styling for consistent CLI output across all commands.
 * Avoids chalk.gray which is nearly invisible on dark terminals.
 *
 * In non-TTY environments, styled output is automatically suppressed:
 * - Use `isPlainOutput()` to check if plain text mode is active
 * - Use `stripAnsi()` to strip ANSI escape codes from strings
 * - Use `plainText()` to conditionally strip ANSI based on TTY detection
 */

import chalk from 'chalk';
import { isNonTTY } from './prompt-json.js';

/**
 * Check if plain text output should be used (no colors, no emoji).
 *
 * Returns true when:
 * - stdout or stdin is not a TTY (piped output)
 * - PRLT_PLAIN=1 environment variable is set (plain text without JSON)
 * - NO_COLOR environment variable is set (standard convention)
 * - PRLT_JSON=1 environment variable is set (JSON mode implies plain)
 * - PRLT_OUTPUT_FORMAT=json environment variable is set
 *
 * @returns true if output should be plain text
 */
export function isPlainOutput(): boolean {
  if (process.env.PRLT_PLAIN === '1' || process.env.PRLT_PLAIN === 'true') {
    return true
  }
  if (process.env.NO_COLOR !== undefined) {
    return true
  }
  if (process.env.PRLT_JSON === '1' || process.env.PRLT_JSON === 'true') {
    return true
  }
  if (process.env.PRLT_OUTPUT_FORMAT === 'json') {
    return true
  }
  return isNonTTY()
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}

// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+/gu;

/**
 * Strip emoji characters from a string
 */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_REGEX, '').replace(/^\s+/, '')
}

/**
 * Convert styled text to plain text if in non-TTY mode.
 * Strips ANSI codes and emoji prefixes.
 *
 * @param text - The styled text
 * @returns Plain text in non-TTY mode, original text in TTY mode
 */
export function plainText(text: string): string {
  if (isPlainOutput()) {
    return stripEmoji(stripAnsi(text))
  }
  return text
}

/**
 * Text styles for different semantic purposes
 */
export const styles = {
  // === Headers & Titles ===
  /** Main title/header - bold cyan */
  title: chalk.bold.cyan,
  /** Section header - bold white */
  header: chalk.bold.white,
  /** Subheader - white */
  subheader: chalk.white,

  // === Status Indicators ===
  /** Success messages - green */
  success: chalk.green,
  /** Warning messages - yellow */
  warning: chalk.yellow,
  /** Error messages - red */
  error: chalk.red,
  /** Info messages - blue */
  info: chalk.blue,

  // === Content ===
  /** Primary content - white (default terminal color) */
  primary: chalk.white,
  /** Secondary/muted content - dim white (visible but subdued) */
  muted: chalk.dim,
  /** Highlighted/emphasized - bold */
  emphasis: chalk.bold,
  /** Code/IDs - cyan */
  code: chalk.cyan,

  // === Semantic Colors ===
  /** Added/new items - green */
  added: chalk.green,
  /** Removed/deleted items - red */
  removed: chalk.red,
  /** Modified/changed items - yellow */
  modified: chalk.yellow,

  // === Priority Colors ===
  priorityUrgent: chalk.red.bold,
  priorityHigh: chalk.red,
  priorityMedium: chalk.yellow,
  priorityLow: chalk.dim,

  // === Column Colors (for board view) ===
  columnBacklog: chalk.blue,
  columnInProgress: chalk.yellow,
  columnReview: chalk.magenta,
  columnBlocked: chalk.red,
  columnDone: chalk.green,
  columnDefault: chalk.white,
};

/**
 * Format a priority badge
 */
export function formatPriority(priority?: string): string {
  if (!priority) return '';

  switch (priority) {
    // New P0-P3 format
    case 'P0':
      return styles.priorityUrgent(`[${priority}]`);
    case 'P1':
      return styles.priorityHigh(`[${priority}]`);
    case 'P2':
      return styles.priorityMedium(`[${priority}]`);
    case 'P3':
      return styles.priorityLow(`[${priority}]`);
    // Legacy format (for backwards compatibility during display)
    case 'URGENT':
      return styles.priorityUrgent('[P0]');
    case 'HIGH':
      return styles.priorityHigh('[P1]');
    case 'MEDIUM':
      return styles.priorityMedium('[P2]');
    case 'LOW':
      return styles.priorityLow('[P3]');
    default:
      return styles.muted(`[${priority}]`);
  }
}

/**
 * Get color for a column name
 */
export function getColumnStyle(column: string): chalk.Chalk {
  // Check for backlog-type columns
  if (column.includes('BL') || column === 'Backlog' || column === 'Ready') {
    return styles.columnBacklog;
  }

  switch (column) {
    case 'In Progress':
      return styles.columnInProgress;
    case 'In Review':
    case 'Review':
      return styles.columnReview;
    case 'Blocked':
      return styles.columnBlocked;
    case 'Done':
    case 'Merged':
    case 'Published':
      return styles.columnDone;
    case 'Dropped':
      return styles.muted;
    default:
      return styles.columnDefault;
  }
}

/**
 * Get emoji for a column
 */
export function getColumnEmoji(column: string): string {
  const emojis: Record<string, string> = {
    'Backlog': '📥',
    'In Progress': '🚀',
    'In Review': '👀',
    'Review': '👀',
    'Blocked': '🚧',
    'Done': '✅',
    'SHIP BL': '🚢',
    'GROW BL': '📈',
    'SUPPORT BL': '🛟',
    'BIZOPS BL': '⚙️',
    'STRATEGY BL': '🎯',
    'Ready': '📥',
    'Merged': '🔀',
    'Published': '🚀',
    'Dropped': '🗑️',
  };
  return emojis[column] || '📋';
}

/**
 * Format a divider line
 */
export function divider(width = 50): string {
  return styles.muted('─'.repeat(width));
}

/**
 * Get color for a priority group header
 */
export function getPriorityStyle(priority: string): chalk.Chalk {
  switch (priority) {
    case 'P0':
      return styles.priorityUrgent;
    case 'P1':
      return styles.priorityHigh;
    case 'P2':
      return styles.priorityMedium;
    case 'P3':
      return styles.priorityLow;
    default:
      return styles.muted;
  }
}

/**
 * Get label for a priority group header
 */
export function getPriorityLabel(priority: string): string {
  return priority;
}

/**
 * Format a category badge
 */
export function formatCategory(category?: string): string {
  if (!category) return '';
  return styles.code(`[${category}]`);
}

/**
 * Format a ticket ID
 */
export function formatTicketId(id: string): string {
  return styles.code(id);
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(): string {
  return styles.muted(`[${new Date().toLocaleTimeString()}]`);
}

/**
 * Standard message prefixes
 */
export const prefix = {
  success: styles.success('✅'),
  error: styles.error('❌'),
  warning: styles.warning('⚠️'),
  info: styles.info('ℹ️'),
  sync: '📥',
  export: '📤',
  watch: '👀',
};

/**
 * Get a TTY-aware prefix - returns plain text alternatives in non-TTY mode
 */
export function getPrefix(type: keyof typeof prefix): string {
  if (isPlainOutput()) {
    const plainPrefixes: Record<string, string> = {
      success: '[OK]',
      error: '[ERROR]',
      warning: '[WARN]',
      info: '[INFO]',
      sync: '[SYNC]',
      export: '[EXPORT]',
      watch: '[WATCH]',
    };
    return plainPrefixes[type] || '';
  }
  return prefix[type];
}
