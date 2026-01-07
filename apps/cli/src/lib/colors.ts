/**
 * Centralized color scheme for consistent, readable output across all commands
 * Optimized for both light and dark terminal backgrounds
 */
import chalk from 'chalk';

export const colors = {
  // Primary colors - highly visible
  primary: chalk.cyan,
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  
  // Text colors - guaranteed readable
  text: chalk.white,
  textBold: chalk.bold.white,
  textSecondary: chalk.cyan,
  textMuted: chalk.dim,
  
  // Status indicators
  active: chalk.green,
  inactive: chalk.red,
  pending: chalk.yellow,
  
  // Special elements
  code: chalk.bold.white.bgBlue,
  path: chalk.bold.cyan,
  command: chalk.bold.white,
  
  // Agent-specific
  agentName: chalk.bold.cyan,
  
  // Repository status
  repoClean: chalk.green,
  repoDirty: chalk.yellow,
  repoMissing: chalk.red,
  commitsAhead: chalk.blue,
  
  // Interactive elements
  selected: chalk.bold.cyan,
  unselected: chalk.white,
  disabled: chalk.dim,

  // Icons and decorations
  icon: chalk.white,
  separator: chalk.dim,
  
  // Background highlights
  highlight: chalk.bgBlue.white,
  attention: chalk.bgYellow.black
};

// Utility functions for common patterns
export const format = {
  title: (text: string) => colors.primary.bold(`\n${text}\n`),
  subtitle: (text: string) => colors.textSecondary(`${text}`),
  success: (text: string) => `${colors.success('✅')} ${colors.text(text)}`,
  error: (text: string) => `${colors.error('❌')} ${colors.text(text)}`,
  warning: (text: string) => `${colors.warning('⚠️')} ${colors.text(text)}`,
  info: (text: string) => `${colors.primary('ℹ️')} ${colors.text(text)}`,
  
  // Agent-specific formatters
  agentActive: (name: string) => `${colors.success('🟢')} ${colors.agentName(name)} - ${colors.active('Active')}`,
  agentInactive: (name: string) => `${colors.error('🔴')} ${colors.agentName(name)} - ${colors.inactive('Inactive')}`,
  
  // Repository formatters
  repoStatus: (name: string, status: 'clean' | 'dirty' | 'missing', commits?: number) => {
    const statusColor = status === 'clean' ? colors.repoClean : 
                       status === 'dirty' ? colors.repoDirty : colors.repoMissing;
    const commitsText = commits ? ` ${colors.commitsAhead(`(+${commits})`)}` : '';
    return `${colors.text(`• ${name}`)} ${statusColor(`(${status})`)}${commitsText}`;
  },
  
  // Command formatters
  command: (text: string) => colors.command(`  ${text}`),
  path: (text: string) => colors.path(text),
  
  // List item formatters
  listItem: (text: string, indent = 2) => colors.text(`${' '.repeat(indent)}${text}`),
  listSubItem: (text: string, indent = 4) => colors.textSecondary(`${' '.repeat(indent)}${text}`)
};

export default { colors, format };