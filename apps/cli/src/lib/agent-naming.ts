/**
 * Agent Naming for Layer 0
 *
 * Simple name generation for standalone sessions (no HQ required).
 * Uses adjective-noun pattern for memorable, unique session names.
 */

const ADJECTIVES = [
  'bold', 'calm', 'cool', 'fast', 'keen', 'lean', 'neat', 'wise',
  'able', 'apt', 'deft', 'fair', 'firm', 'glad', 'hale', 'just',
  'kind', 'live', 'mild', 'open', 'pure', 'rare', 'safe', 'warm',
]

const NOUNS = [
  'ace', 'arc', 'bay', 'cog', 'dot', 'elm', 'fox', 'gem',
  'hex', 'ion', 'jet', 'key', 'lux', 'map', 'net', 'oak',
  'pip', 'ray', 'sky', 'tor', 'vox', 'web', 'zen', 'bit',
]

/**
 * Generate a random agent name like "bold-fox" or "calm-ray".
 */
export function generateAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

/**
 * Build a tmux session name for a Layer 0 session.
 * Format: prlt-{runner}-{agentName}
 */
export function buildLayer0SessionName(runner: string, agentName: string): string {
  return `prlt-${runner}-${agentName}`
}
