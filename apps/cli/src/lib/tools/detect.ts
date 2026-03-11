/**
 * Tool Detection
 *
 * Auto-detect CLI tools available on the system.
 */

import { execSync } from 'node:child_process'
import type { CliToolEntry } from './types.js'
import { COMMON_CLI_TOOLS } from './types.js'

/**
 * Check if a single CLI tool is available on the system.
 */
export function checkToolAvailability(entry: CliToolEntry): boolean {
  const detectCmd = entry.detect ?? `which ${entry.command}`
  try {
    execSync(detectCmd, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Auto-detect common CLI tools available on the system.
 * Returns entries for tools that are found.
 */
export function detectAvailableTools(): Record<string, CliToolEntry & { available: boolean }> {
  const results: Record<string, CliToolEntry & { available: boolean }> = {}

  for (const [name, entry] of Object.entries(COMMON_CLI_TOOLS)) {
    const available = checkToolAvailability(entry)
    results[name] = { ...entry, available }
  }

  return results
}

/**
 * Check health of all registered tools.
 * Returns status for each tool.
 */
export function checkRegisteredTools(
  mcpServers: Record<string, { url?: string; command?: string }>,
  cliTools: Record<string, CliToolEntry>,
): Array<{ name: string; type: 'mcp' | 'cli'; status: 'ok' | 'missing' | 'unknown'; detail?: string }> {
  const results: Array<{ name: string; type: 'mcp' | 'cli'; status: 'ok' | 'missing' | 'unknown'; detail?: string }> = []

  // Check CLI tools
  for (const [name, entry] of Object.entries(cliTools)) {
    const available = checkToolAvailability(entry)
    results.push({
      name,
      type: 'cli',
      status: available ? 'ok' : 'missing',
      detail: available ? undefined : entry.install ? `Install: ${entry.install}` : undefined,
    })
  }

  // Check MCP servers (basic reachability)
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (entry.command) {
      // Local MCP server - check if command exists
      try {
        const cmd = entry.command.split(' ')[0]
        execSync(`which ${cmd}`, { stdio: 'pipe' })
        results.push({ name, type: 'mcp', status: 'ok' })
      } catch {
        results.push({ name, type: 'mcp', status: 'missing', detail: `Command not found: ${entry.command}` })
      }
    } else if (entry.url) {
      // Remote MCP server - we can't easily check without making a request
      results.push({ name, type: 'mcp', status: 'unknown', detail: `Remote: ${entry.url}` })
    } else {
      results.push({ name, type: 'mcp', status: 'unknown', detail: 'No URL or command configured' })
    }
  }

  return results
}
