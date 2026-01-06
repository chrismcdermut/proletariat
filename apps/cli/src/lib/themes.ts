import {
  openWorkspaceDatabase,
  createTheme,
  addThemeNames,
  getThemes,
  AgentTheme
} from './database/index.js';

/**
 * Default workspace directory for agents
 */
export const DEFAULT_AGENTS_DIR = 'agents';

/**
 * Validate an agent name
 * Agent names must be lowercase alphanumeric with optional hyphens/underscores
 */
export function isValidAgentName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(name);
}

/**
 * Normalize a name to valid agent name format:
 * - Convert to lowercase
 * - Replace spaces with dashes
 * - Remove any invalid characters
 */
export function normalizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // spaces to dashes
    .replace(/[^a-z0-9-_]/g, '');   // remove invalid chars
}

/**
 * Get suggested agent names (for interactive selection when no theme)
 */
export function getSuggestedAgentNames(): string[] {
  return ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
}

// =============================================================================
// Built-in Themes
// =============================================================================

export interface BuiltinThemeDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  names: string[];
}

export const BUILTIN_THEMES: BuiltinThemeDefinition[] = [
  {
    id: 'billionaires',
    name: 'billionaires',
    displayName: 'Billionaires & Tech Elite',
    description: 'The ultra-wealthy work for you',
    names: [
      'altman', 'andreesen', 'bezos', 'branson', 'brin', 'buffett',
      'cook', 'dalio', 'damodei', 'dorsey', 'ellison', 'gates', 'huang',
      'iger', 'jobs', 'kalanick', 'karpathy', 'lecun', 'ma', 'musk',
      'nadella', 'page', 'pichai', 'sandberg', 'schultz', 'sutskever',
      'thiel', 'wojcicki', 'zuck'
    ]
  },
  {
    id: 'toyotas',
    name: 'toyotas',
    displayName: 'Toyota Garage',
    description: 'Reliable workhorses for your project',
    names: [
      '4runner', 'avalon', 'camry', 'celica', 'corolla', 'cressida',
      'fj40', 'fj60', 'fj80', 'highlander', 'hilux', 'landcruiser',
      'mr2', 'prius', 'rav4', 'sequoia', 'sienna', 'supra', 'tacoma',
      'tercel', 'tundra', 'venza', 'yaris'
    ]
  },
  {
    id: 'companies',
    name: 'companies',
    displayName: 'Company Portfolio',
    description: 'Your corporate portfolio',
    names: [
      'adobe', 'airbnb', 'amazon', 'apple', 'atlassian', 'cisco',
      'coinbase', 'databricks', 'discord', 'dropbox', 'figma', 'github',
      'google', 'intel', 'meta', 'microsoft', 'netflix', 'notion',
      'nvidia', 'openai', 'oracle', 'palantir', 'salesforce', 'shopify',
      'slack', 'snowflake', 'spotify', 'square', 'stripe', 'tesla',
      'twilio', 'twitter', 'uber', 'vercel', 'zoom'
    ]
  }
];

/**
 * Ensure built-in themes are seeded in the database
 * Called lazily when themes are first used
 */
export function ensureBuiltinThemes(workspacePath: string): void {
  const existingThemes = getThemes(workspacePath);
  const existingIds = new Set(existingThemes.map(t => t.id));

  for (const theme of BUILTIN_THEMES) {
    if (!existingIds.has(theme.id)) {
      // Create the theme
      createTheme(workspacePath, {
        id: theme.id,
        name: theme.name,
        displayName: theme.displayName,
        description: theme.description,
        builtin: true
      });

      // Add names to the theme
      addThemeNames(workspacePath, theme.id, theme.names);
    }
  }
}

/**
 * Get a built-in theme by ID (from constants, not database)
 */
export function getBuiltinTheme(themeId: string): BuiltinThemeDefinition | undefined {
  return BUILTIN_THEMES.find(t => t.id === themeId);
}

/**
 * Check if a theme ID is a built-in theme
 */
export function isBuiltinTheme(themeId: string): boolean {
  return BUILTIN_THEMES.some(t => t.id === themeId);
}
