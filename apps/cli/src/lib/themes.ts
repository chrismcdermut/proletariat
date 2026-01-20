import {
  createTheme,
  addThemeNames,
  getThemes,
} from './database/index.js';

/**
 * Default workspace directory for agents
 */
export const DEFAULT_AGENTS_DIR = 'staff';

/**
 * Directory for ephemeral/temp agents
 */
export const TEMP_AGENTS_DIR = 'temp';

/**
 * Adjectives for ephemeral agent name generation
 */
export const AGENT_ADJECTIVES = [
  'bold', 'calm', 'cool', 'deep', 'fair', 'fast', 'firm', 'free', 'good',
  'keen', 'kind', 'neat', 'pure', 'safe', 'sure', 'true', 'warm', 'wise',
  'able', 'avid', 'blue', 'deft', 'fine', 'glad', 'gold', 'open', 'real',
  'rich', 'soft', 'tall', 'vast', 'wild', 'zest'
];

/**
 * Validate an agent name
 * Agent names must be alphanumeric with optional hyphens/underscores (case-insensitive for uniqueness)
 */
export function isValidAgentName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name);
}

/**
 * Normalize a name to valid agent name format:
 * - Trim whitespace
 * - Replace spaces with dashes
 * - Remove any invalid characters
 * Note: Preserves case - uniqueness is enforced case-insensitively elsewhere
 */
export function normalizeAgentName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')              // spaces to dashes
    .replace(/[^a-zA-Z0-9-_]/g, '');   // remove invalid chars
}

/**
 * Get the canonical (lowercase) form of a name for uniqueness comparisons
 */
export function canonicalAgentName(name: string): string {
  return name.toLowerCase();
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

/**
 * Pick a random adjective from the list
 */
export function pickAdjective(): string {
  return AGENT_ADJECTIVES[Math.floor(Math.random() * AGENT_ADJECTIVES.length)];
}

/**
 * Pick a random theme name from a specific theme
 */
export function pickThemeName(themeId: string): string {
  const theme = BUILTIN_THEMES.find(t => t.id === themeId);
  if (!theme) {
    // Fall back to billionaires if theme not found
    const fallback = BUILTIN_THEMES[0];
    return fallback.names[Math.floor(Math.random() * fallback.names.length)];
  }
  return theme.names[Math.floor(Math.random() * theme.names.length)];
}

/**
 * Pick a random theme name from any available theme
 */
export function pickRandomThemeName(): { themeName: string; themeId: string } {
  const theme = BUILTIN_THEMES[Math.floor(Math.random() * BUILTIN_THEMES.length)];
  const name = theme.names[Math.floor(Math.random() * theme.names.length)];
  return { themeName: name, themeId: theme.id };
}

/**
 * Generate a unique ephemeral agent name.
 * Format: {adjective}-{theme_name}-{number}
 * Example: "bold-bezos-1", "keen-camry-2"
 *
 * @param existingNames - Set of existing agent names (for uniqueness checking)
 * @param themeId - Optional theme ID to pick name from (defaults to random)
 */
export function generateEphemeralAgentName(
  existingNames: Set<string>,
  themeId?: string
): string {
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const adjective = pickAdjective();
    const themeName = themeId ? pickThemeName(themeId) : pickRandomThemeName().themeName;

    // Try finding a unique number suffix
    for (let num = 1; num <= 999; num++) {
      const candidateName = `${adjective}-${themeName}-${num}`;
      if (!existingNames.has(candidateName.toLowerCase())) {
        return candidateName;
      }
    }
  }

  // Fallback: use timestamp if all attempts fail
  const timestamp = Date.now().toString(36);
  return `agent-${timestamp}`;
}

/**
 * Check if a name looks like an ephemeral agent name.
 * Ephemeral names follow pattern: {adjective}-{name}-{number}
 */
export function isEphemeralAgentName(name: string): boolean {
  const parts = name.split('-');
  if (parts.length < 3) return false;

  const lastPart = parts[parts.length - 1];
  const num = parseInt(lastPart, 10);
  if (isNaN(num) || num < 1) return false;

  const adjective = parts[0].toLowerCase();
  return AGENT_ADJECTIVES.includes(adjective);
}
