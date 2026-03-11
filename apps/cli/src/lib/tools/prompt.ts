/**
 * Tool Prompt Injection
 *
 * Generate AVAILABLE TOOLS section for agent prompts.
 */

import type { ResolvedToolContext } from './types.js'

/**
 * Build the AVAILABLE TOOLS section for agent prompts.
 * This tells the agent what external tools it can use.
 */
export function buildToolsPromptSection(context: ResolvedToolContext): string {
  const hasMcp = context.mcpServers.length > 0
  const hasCli = context.cliTools.filter(t => t.available).length > 0

  if (!hasMcp && !hasCli) {
    return ''
  }

  let section = `## Available Tools\n\n`

  if (hasMcp) {
    const mcpList = context.mcpServers
      .map(s => {
        const desc = s.description ? ` (${s.description})` : ''
        return `${s.name}${desc}`
      })
      .join(', ')
    section += `**MCP Servers:** ${mcpList}\n`
  }

  if (hasCli) {
    const cliList = context.cliTools
      .filter(t => t.available)
      .map(t => {
        const desc = t.description ? ` (${t.description})` : ''
        return `${t.name}${desc}`
      })
      .join(', ')
    section += `**CLI Tools:** ${cliList}\n`
  }

  section += `\nUse these tools for external interactions. Do NOT use curl or raw API calls when a dedicated tool is available.\n`

  return section
}
