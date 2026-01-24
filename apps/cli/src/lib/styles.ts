/**
 * CLI Output Style Guide
 *
 * Centralized styling for consistent CLI output across all commands.
 * Avoids chalk.gray which is nearly invisible on dark terminals.
 */

import chalk from 'chalk';

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
