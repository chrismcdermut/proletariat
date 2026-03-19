/**
 * Per-HQ Configuration Storage
 *
 * Stores PMO provider and AI tool preferences in the workspace_settings table.
 * These are per-HQ, not machine-level — a user might have one HQ using Linear
 * and another using GitHub Issues.
 */

const SETTINGS_TABLE = 'workspace_settings';

export interface HQPMOProviderConfig {
  provider: string;
  connected: boolean;
}

export interface HQAIToolConfig {
  tool: string;
  command: string;
}

// Config keys stored in workspace_settings table
const HQ_CONFIG_KEYS = {
  pmoProvider: 'hq.pmo_provider',
  pmoProviderConnected: 'hq.pmo_provider_connected',
  aiTool: 'hq.ai_tool',
  aiToolCommand: 'hq.ai_tool_command',
};

/**
 * Supported PMO providers with display info and API key instructions.
 */
export const PMO_PROVIDERS = [
  {
    name: 'Linear',
    value: 'linear',
    connectCommand: 'prlt linear connect',
    apiKeyUrl: 'https://linear.app/settings/api',
    apiKeyInstructions: 'Create a personal API key at Linear Settings > API',
  },
  {
    name: 'GitHub Issues',
    value: 'github',
    connectCommand: 'prlt gh connect',
    apiKeyUrl: 'https://github.com/settings/tokens',
    apiKeyInstructions: 'Create a personal access token with repo scope at GitHub Settings > Developer settings > Tokens',
  },
  {
    name: 'Jira',
    value: 'jira',
    connectCommand: 'prlt jira connect',
    apiKeyUrl: 'https://id.atlassian.net/manage-profile/security/api-tokens',
    apiKeyInstructions: 'Create an API token at Atlassian Account > Security > API tokens',
  },
  {
    name: 'Asana',
    value: 'asana',
    connectCommand: 'prlt asana connect',
    apiKeyUrl: 'https://app.asana.com/0/my-apps',
    apiKeyInstructions: 'Create a personal access token at Asana > My Settings > Apps > Developer Apps',
  },
  {
    name: 'Trello',
    value: 'trello',
    connectCommand: 'prlt trello connect',
    apiKeyUrl: 'https://trello.com/power-ups/admin',
    apiKeyInstructions: 'Get your API key and token from Trello Power-Ups admin page',
  },
  {
    name: 'Monday.com',
    value: 'monday',
    connectCommand: 'prlt monday connect',
    apiKeyUrl: 'https://monday.com/developers/apps',
    apiKeyInstructions: 'Create an API token at Monday.com > Developers > My Access Tokens',
  },
  {
    name: 'Shortcut (formerly Clubhouse)',
    value: 'shortcut',
    connectCommand: 'prlt shortcut connect',
    apiKeyUrl: 'https://app.shortcut.com/settings/account/api-tokens',
    apiKeyInstructions: 'Create an API token at Shortcut Settings > API Tokens',
  },
  {
    name: 'None (use local PMO only)',
    value: 'none',
    connectCommand: '',
    apiKeyUrl: '',
    apiKeyInstructions: 'No external provider — tickets are managed locally in the PMO board.',
  },
] as const;

export type PMOProviderValue = typeof PMO_PROVIDERS[number]['value'];

// Database helpers
function getSetting(db: import('better-sqlite3').Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: import('better-sqlite3').Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Save PMO provider choice to HQ config.
 */
export function saveHQPMOProvider(db: import('better-sqlite3').Database, provider: string, connected: boolean): void {
  setSetting(db, HQ_CONFIG_KEYS.pmoProvider, provider);
  setSetting(db, HQ_CONFIG_KEYS.pmoProviderConnected, connected ? 'true' : 'false');
}

/**
 * Load PMO provider config from HQ.
 */
export function loadHQPMOProvider(db: import('better-sqlite3').Database): HQPMOProviderConfig | null {
  const provider = getSetting(db, HQ_CONFIG_KEYS.pmoProvider);
  if (!provider) return null;
  const connected = getSetting(db, HQ_CONFIG_KEYS.pmoProviderConnected) === 'true';
  return { provider, connected };
}

/**
 * Save AI tool choice to HQ config.
 */
export function saveHQAITool(db: import('better-sqlite3').Database, tool: string, command: string): void {
  setSetting(db, HQ_CONFIG_KEYS.aiTool, tool);
  setSetting(db, HQ_CONFIG_KEYS.aiToolCommand, command);
}

/**
 * Load AI tool config from HQ.
 */
export function loadHQAITool(db: import('better-sqlite3').Database): HQAIToolConfig | null {
  const tool = getSetting(db, HQ_CONFIG_KEYS.aiTool);
  if (!tool) return null;
  const command = getSetting(db, HQ_CONFIG_KEYS.aiToolCommand) ?? tool;
  return { tool, command };
}
