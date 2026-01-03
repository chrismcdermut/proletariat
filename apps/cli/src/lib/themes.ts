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
 * Get suggested agent names (for interactive selection)
 */
export function getSuggestedAgentNames(): string[] {
  return ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
}