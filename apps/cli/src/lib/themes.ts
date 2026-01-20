import {
  createTheme,
  addThemeNames,
  getThemes,
  getActiveTheme,
  getThemeNames,
} from './database/index.js';

/**
 * Default workspace directory for agents
 */
export const DEFAULT_AGENTS_DIR = 'staff';

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

// =============================================================================
// Ephemeral Agent Names
// =============================================================================

/**
 * Adjectives for ephemeral agent names
 * Used to create unique names like "bold-bezos-1", "swift-altman-2"
 */
export const AGENT_ADJECTIVES = [
  // Positive traits
  'bold', 'swift', 'sharp', 'keen', 'wise',
  'bright', 'quick', 'brave', 'calm', 'cool',
  'eager', 'fair', 'firm', 'free', 'glad',
  'grand', 'great', 'kind', 'neat', 'nice',
  'prime', 'pure', 'rare', 'rich', 'safe',
  'smart', 'true', 'warm', 'wild', 'able',
  // Energy and action
  'agile', 'alert', 'alive', 'apt', 'busy',
  'crisp', 'deft', 'fast', 'fit', 'lean',
  'lively', 'nimble', 'ready', 'spry', 'sure',
  // Focus and determination
  'clear', 'driven', 'exact', 'fixed', 'focused',
  'intent', 'precise', 'steady', 'strict', 'tight',
  // Strength
  'fierce', 'hardy', 'mighty', 'robust', 'solid',
  'sound', 'stable', 'stout', 'strong', 'sturdy',
  'tough', 'vital',
  // Innovation
  'fresh', 'novel', 'new', 'sleek', 'modern',
];

/**
 * Pick a random adjective
 */
export function pickAdjective(): string {
  return AGENT_ADJECTIVES[Math.floor(Math.random() * AGENT_ADJECTIVES.length)];
}

/**
 * Pick a random name from the active theme in a workspace
 * Falls back to the billionaires theme if no theme is active
 */
export function pickThemeName(workspacePath: string): string {
  try {
    // Try to get the active theme from the database
    const activeTheme = getActiveTheme(workspacePath);

    if (activeTheme) {
      // Get names for the active theme
      const themeNames = getThemeNames(workspacePath, activeTheme.id);
      if (themeNames.length > 0) {
        const availableNames = themeNames.map(n => n.name);
        return availableNames[Math.floor(Math.random() * availableNames.length)];
      }
    }

    // Try to get names from the billionaires theme
    const themes = getThemes(workspacePath);
    const billionaires = themes.find(t => t.id === 'billionaires');
    if (billionaires) {
      const themeNames = getThemeNames(workspacePath, billionaires.id);
      if (themeNames.length > 0) {
        const availableNames = themeNames.map(n => n.name);
        return availableNames[Math.floor(Math.random() * availableNames.length)];
      }
    }
  } catch {
    // Fall back to built-in billionaires theme
  }

  // Default fallback to built-in billionaires theme (no database access needed)
  const billionairesTheme = BUILTIN_THEMES.find(t => t.id === 'billionaires')!;
  return billionairesTheme.names[Math.floor(Math.random() * billionairesTheme.names.length)];
}

/**
 * Generate a unique ephemeral agent name
 * Format: {adjective}-{themeName}-{number}
 * Example: "bold-bezos-1", "swift-altman-2"
 *
 * @param workspacePath - Path to the workspace (for checking existing agents)
 * @param existingNames - Optional set of existing agent names to avoid conflicts
 */
export function generateEphemeralName(workspacePath: string, existingNames?: Set<string>): string {
  const adjective = pickAdjective();
  const themeName = pickThemeName(workspacePath);

  // Get existing ephemeral agents to find next number
  let existingSet = existingNames;
  if (!existingSet) {
    try {
      const { getWorkspaceAgents } = require('./database/index.js');
      const agents = getWorkspaceAgents(workspacePath);
      existingSet = new Set(agents.map((a: { name: string }) => a.name.toLowerCase()));
    } catch {
      existingSet = new Set();
    }
  }

  // Find the next available number for this adjective-name combination
  let number = 1;
  while (existingSet.has(`${adjective}-${themeName}-${number}`.toLowerCase())) {
    number++;
  }

  return `${adjective}-${themeName}-${number}`;
}

/**
 * Parse an ephemeral agent name into its components
 * Returns null if the name is not in ephemeral format
 */
export function parseEphemeralName(name: string): { adjective: string; baseName: string; number: number } | null {
  const match = name.match(/^([a-z]+)-([a-z]+)-(\d+)$/i);
  if (!match) {
    return null;
  }

  return {
    adjective: match[1].toLowerCase(),
    baseName: match[2].toLowerCase(),
    number: parseInt(match[3], 10),
  };
}

/**
 * Check if an agent name is in ephemeral format
 */
export function isEphemeralAgentName(name: string): boolean {
  return parseEphemeralName(name) !== null;
}

/**
 * Ephemeral agents directory name
 */
export const EPHEMERAL_AGENTS_DIR = 'temp';

/**
 * Persistent agents directory name (staff)
 */
export const PERSISTENT_AGENTS_DIR = 'staff';
