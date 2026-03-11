/**
 * Tool Context Resolution
 *
 * Convenience function to load tool registry, apply policy,
 * and attach resolved tool context to an ExecutionContext.
 */

import type { ExecutionContext } from '../execution/types.js'
import { loadToolRegistry, ensureBuiltinTools } from './registry.js'
import { loadPolicy, resolveToolContext } from './policy.js'
import { generateMcpConfig, writeMcpConfigFile } from './mcp-config.js'

/**
 * Resolve tool registry and attach tool context to an ExecutionContext.
 * Loads tools.yaml, applies agent/action policy, generates MCP config if needed.
 *
 * This is a convenience function used by both the spawner and work/start.ts
 * to avoid duplicating tool resolution logic.
 */
export function resolveAndAttachToolContext(
  context: ExecutionContext,
  hqPath: string,
  agentName?: string,
  actionId?: string,
): void {
  try {
    const registry = ensureBuiltinTools(loadToolRegistry(hqPath))

    // Try loading agent-specific policy, then action-based policy, then no policy
    const policy = (agentName ? loadPolicy(hqPath, agentName) : null)
      ?? (actionId ? loadPolicy(hqPath, actionId) : null)

    const toolCtx = resolveToolContext(registry, policy)
    context.toolContext = toolCtx

    // Generate MCP config file if there are MCP servers
    if (toolCtx.mcpServers.length > 0) {
      const mcpConfig = generateMcpConfig(toolCtx.mcpServers)
      context.mcpConfigPath = writeMcpConfigFile(mcpConfig, hqPath)
    }
  } catch {
    // Non-fatal: tool registry loading failures shouldn't block agent spawning
  }
}
