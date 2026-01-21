import {
  createTheme,
  addThemeNames,
  getThemes,
} from './database/index.js';

/**
 * Default workspace directory for persistent agents (fallback if no theme)
 */
export const DEFAULT_AGENTS_DIR = 'staff';

/**
 * Default directory for ephemeral agents (fallback if no theme)
 */
export const TEMP_AGENTS_DIR = 'temp';

/**
 * Default theme for ephemeral agent name generation
 */
export const DEFAULT_EPHEMERAL_THEME = 'billionaires';

/**
 * Adjectives for ephemeral agent name generation
 * ~100 short, positive adjectives for readable agent names
 */
export const AGENT_ADJECTIVES = [
  // Original set
  'bold', 'calm', 'cool', 'deep', 'fair', 'fast', 'firm', 'free', 'good',
  'keen', 'kind', 'neat', 'pure', 'safe', 'sure', 'true', 'warm', 'wise',
  'able', 'avid', 'blue', 'deft', 'fine', 'glad', 'gold', 'open', 'real',
  'rich', 'soft', 'tall', 'vast', 'wild', 'zest',
  // Expanded set
  'apt', 'big', 'brave', 'bright', 'brisk', 'busy', 'chief', 'civic',
  'civil', 'clean', 'clear', 'close', 'crisp', 'dense', 'dry', 'dual',
  'due', 'eager', 'early', 'easy', 'elite', 'epic', 'equal', 'even',
  'exact', 'extra', 'faint', 'fancy', 'first', 'fit', 'flat', 'fleet',
  'flush', 'focal', 'fond', 'frank', 'fresh', 'full', 'game', 'grand',
  'grave', 'great', 'green', 'hale', 'happy', 'hardy', 'hasty', 'hazy',
  'heavy', 'high', 'hot', 'huge', 'ideal', 'key', 'large', 'late', 'lean',
  'legal', 'light', 'lithe', 'live', 'local', 'long', 'loose', 'loud',
  'loyal', 'lucid', 'lucky', 'lunar', 'lusty', 'mad', 'main', 'major',
  'meek', 'merry', 'mild', 'mini', 'minor', 'mint', 'modal', 'modern',
  'moist', 'moral', 'naval', 'new', 'next', 'nice', 'noble', 'novel',
  'odd', 'outer', 'pale', 'peak', 'perky', 'phat', 'plush', 'polar',
  'polite', 'prime', 'proud', 'quick', 'quiet', 'rapid', 'rare', 'raw',
  'ready', 'regal', 'royal', 'ruby', 'rural', 'rusty', 'salty', 'sandy',
  'sassy', 'shiny', 'short', 'silky', 'slick', 'slim', 'slow', 'small',
  'smart', 'smooth', 'snug', 'solar', 'solid', 'sonic', 'sound', 'spare',
  'stark', 'steady', 'steel', 'steep', 'stoic', 'stout', 'strong', 'super',
  'sweet', 'swift', 'tame', 'tart', 'tense', 'thick', 'thin', 'tidy',
  'tight', 'tiny', 'top', 'total', 'tough', 'trim', 'ultra', 'upper',
  'urban', 'valid', 'vivid', 'vocal', 'wary', 'whole', 'wide', 'witty',
  'young', 'zappy', 'zen', 'zero', 'zippy', 'zonal'
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
  /** Directory for persistent/staff agents (default: 'staff') */
  persistentDir: string;
  /** Directory for ephemeral/temp agents (default: 'temp') */
  ephemeralDir: string;
}

export const BUILTIN_THEMES: BuiltinThemeDefinition[] = [
  {
    id: 'billionaires',
    name: 'billionaires',
    displayName: 'Billionaires & Tech Elite',
    description: 'The ultra-wealthy work for you',
    persistentDir: 'staff',
    ephemeralDir: 'temp',
    names: [
      // Tech founders & executives
      'altman', 'andreesen', 'bezos', 'branson', 'brin', 'buffett',
      'cook', 'dalio', 'dario', 'dorsey', 'ellison', 'gates', 'huang',
      'iger', 'jobs', 'kalanick', 'karpathy', 'lecun', 'ma', 'musk',
      'nadella', 'page', 'pichai', 'sandberg', 'schultz', 'sutskever',
      'thiel', 'wojcicki', 'zuck',
      // More tech leaders
      'ballmer', 'benioff', 'chesky', 'collison', 'dell', 'durov',
      'fink', 'fridman', 'grove', 'hastings', 'hoffman', 'horowitz',
      'hurd', 'ive', 'khosla', 'knight', 'kutcher', 'levie', 'levinson',
      'lynch', 'marcus', 'mayer', 'mcnealy', 'morin', 'neumann',
      'omidyar', 'packard', 'parker', 'powell', 'rabois', 'rometty',
      'ross', 'schmidt', 'sequoia', 'siebel', 'silbermann', 'sinofsky',
      'spiegel', 'spolsky', 'sweeney', 'systrom', 'torvalds', 'wales',
      'wozniak', 'yang', 'yegge', 'zhang', 'zhong'
    ]
  },
  {
    id: 'toyotas',
    name: 'toyotas',
    displayName: 'Toyota Garage',
    description: 'Reliable workhorses for your project',
    persistentDir: 'garage',
    ephemeralDir: 'pit',
    names: [
      // Classic & current models
      '4runner', 'avalon', 'camry', 'celica', 'corolla', 'cressida',
      'fj40', 'fj60', 'fj80', 'highlander', 'hilux', 'landcruiser',
      'mr2', 'prius', 'rav4', 'sequoia', 'sienna', 'supra', 'tacoma',
      'tercel', 'tundra', 'venza', 'yaris',
      // More models & variants
      'auris', 'belta', 'brevis', 'caldina', 'carina', 'century',
      'chaser', 'coaster', 'corona', 'cresta', 'crown', 'dyna',
      'estima', 'etios', 'fortuner', 'granvia', 'harrier', 'innova',
      'ipsum', 'kluger', 'levin', 'lite', 'lucida', 'mark2',
      'matrix', 'mirai', 'noah', 'paseo', 'picnic', 'platz',
      'previa', 'premio', 'probox', 'raize', 'rukus', 'sera',
      'soarer', 'solara', 'starlet', 'surf', 'tarago', 'trueno',
      'urban', 'verso', 'vios', 'vista', 'vitz', 'wish'
    ]
  },
  {
    id: 'companies',
    name: 'companies',
    displayName: 'Company Portfolio',
    description: 'Your corporate portfolio',
    persistentDir: 'portfolio',
    ephemeralDir: 'incubator',
    names: [
      // Major tech companies
      'adobe', 'airbnb', 'amazon', 'apple', 'atlassian', 'cisco',
      'coinbase', 'databricks', 'discord', 'dropbox', 'figma', 'github',
      'google', 'intel', 'meta', 'microsoft', 'netflix', 'notion',
      'nvidia', 'openai', 'oracle', 'palantir', 'salesforce', 'shopify',
      'slack', 'snowflake', 'spotify', 'square', 'stripe', 'tesla',
      'twilio', 'twitter', 'uber', 'vercel', 'zoom',
      // More companies
      'airtable', 'algolia', 'asana', 'auth0', 'brex', 'canva',
      'carta', 'checkout', 'clickup', 'cloudera', 'contentful', 'datadog',
      'deel', 'docusign', 'doordash', 'elastic', 'fastly', 'fivetran',
      'gitlab', 'gusto', 'hashicorp', 'hubspot', 'instacart', 'klarna',
      'launchdark', 'linear', 'loom', 'lyft', 'mailchimp', 'miro',
      'monday', 'mongo', 'netlify', 'okta', 'pagerduty', 'plaid',
      'postman', 'reddit', 'retool', 'revolut', 'rippling', 'robinhood',
      'segment', 'sentry', 'supabase', 'toast', 'twitch', 'webflow',
      'wiz', 'workday', 'zendesk', 'zscaler'
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
 * Get the persistent agents directory name for a theme
 * Falls back to DEFAULT_AGENTS_DIR if theme not found
 */
export function getThemePersistentDir(themeId?: string): string {
  if (!themeId) return DEFAULT_AGENTS_DIR;
  const theme = BUILTIN_THEMES.find(t => t.id === themeId);
  return theme?.persistentDir ?? DEFAULT_AGENTS_DIR;
}

/**
 * Get the ephemeral agents directory name for a theme
 * Falls back to TEMP_AGENTS_DIR if theme not found
 */
export function getThemeEphemeralDir(themeId?: string): string {
  if (!themeId) return TEMP_AGENTS_DIR;
  const theme = BUILTIN_THEMES.find(t => t.id === themeId);
  return theme?.ephemeralDir ?? TEMP_AGENTS_DIR;
}

/**
 * Get both directory names for a theme
 */
export function getThemeDirectories(themeId?: string): { persistentDir: string; ephemeralDir: string } {
  return {
    persistentDir: getThemePersistentDir(themeId),
    ephemeralDir: getThemeEphemeralDir(themeId),
  };
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
 * Options for ephemeral agent name generation
 */
export interface GenerateEphemeralNameOptions {
  themeId?: string;
  /**
   * Optional callback to check if a candidate name conflicts with external resources.
   * Returns { conflict: true, reason: string } if there's a conflict, or { conflict: false } if not.
   * This allows checking for tmux sessions, directories, etc. that aren't in the database.
   */
  checkExternalConflict?: (name: string) => { conflict: boolean; reason?: string };
  /**
   * Optional callback for logging/messaging when conflicts are detected
   */
  onConflictSkipped?: (name: string, reason: string) => void;
}

/**
 * Generate a unique ephemeral agent name.
 * Format: {adjective}-{theme_name}-{number}
 * Example: "bold-bezos-1", "keen-camry-2"
 *
 * @param existingNames - Set of existing agent names (for uniqueness checking)
 * @param options - Optional configuration for name generation
 */
export function generateEphemeralAgentName(
  existingNames: Set<string>,
  options?: GenerateEphemeralNameOptions | string
): string {
  // Handle backwards compatibility: string arg = themeId
  const opts: GenerateEphemeralNameOptions = typeof options === 'string'
    ? { themeId: options }
    : (options ?? {});

  const maxAttempts = 100;

  // Use specified theme or default (no mixing themes)
  const themeId = opts.themeId ?? DEFAULT_EPHEMERAL_THEME;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const adjective = pickAdjective();
    const themeName = pickThemeName(themeId);

    // Try finding a unique number suffix (4 digits max)
    for (let num = 1; num <= 9999; num++) {
      const candidateName = `${adjective}-${themeName}-${num}`;

      // Check database/in-memory conflicts first
      if (existingNames.has(candidateName.toLowerCase())) {
        continue;
      }

      // Check external resource conflicts if callback provided
      if (opts.checkExternalConflict) {
        const result = opts.checkExternalConflict(candidateName);
        if (result.conflict) {
          opts.onConflictSkipped?.(candidateName, result.reason ?? 'external conflict');
          continue;
        }
      }

      return candidateName;
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
