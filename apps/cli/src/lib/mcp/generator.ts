/**
 * MCP Tool Auto-Generator
 *
 * Walks oclif command definitions and auto-generates MCP tool registrations.
 * Each generated tool calls `ctx.runCommand('prlt <command> --json')` to invoke
 * the CLI command, routing through the proper provider adapter.
 *
 * Manual overrides in `tools/overrides/` take precedence over generated tools.
 */

import { z } from 'zod'
import type { Command } from '@oclif/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from './types.js'
import { strictTool, textResponse, errorResponse } from './helpers.js'

/**
 * Commands excluded from auto-generation.
 * These are oclif internals, the MCP server itself, or commands
 * that don't make sense as MCP tools.
 */
const EXCLUDED_COMMANDS = new Set([
  // MCP server itself (would be recursive)
  'mcp-server',
  // oclif plugin commands
  'plugins',
  'plugins:inspect',
  'plugins:install',
  'plugins:add',
  'plugins:link',
  'plugins:reset',
  'plugins:uninstall',
  'plugins:unlink',
  'plugins:remove',
  'plugins:update',
  // oclif built-ins
  'help',
  'commands',
  'autocomplete',
  'autocomplete:setup',
  // Self-update (not useful for MCP)
  'update',
  'self-update',
])

/**
 * Convert an oclif command ID to an MCP tool name.
 * E.g., "ticket:list" → "ticket_list", "agent:staff:add" → "agent_staff_add"
 */
export function commandIdToToolName(commandId: string): string {
  return commandId.replace(/:/g, '_').replace(/-/g, '_')
}

/**
 * Convert an MCP tool name back to CLI command args.
 * Uses the original command ID (with colons) and the oclif topic separator (space).
 * E.g., "ticket:list" → "ticket list"
 */
function commandIdToCliArgs(commandId: string): string {
  return commandId.replace(/:/g, ' ')
}

/**
 * Build a Zod schema shape from oclif flag and arg definitions.
 */
function buildZodSchema(
  command: Command.Cached,
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {}

  // Add args as schema parameters
  if (command.args) {
    for (const [name, arg] of Object.entries(command.args)) {
      const argName = toSnakeCase(name)
      let schema: z.ZodType = z.string()
      if (arg.options && arg.options.length > 0) {
        schema = z.enum(arg.options as [string, ...string[]])
      }
      schema = schema.describe(arg.description || `Positional argument: ${name}`)
      if (!arg.required) {
        schema = schema.optional()
      }
      shape[argName] = schema
    }
  }

  // Add flags as schema parameters
  if (command.flags) {
    for (const [name, flag] of Object.entries(command.flags)) {
      // Skip internal/meta flags that we handle automatically
      if (name === 'json' || name === 'machine') continue

      const paramName = toSnakeCase(name)

      if (flag.type === 'boolean') {
        let schema: z.ZodType = z.boolean().describe(flag.description || `Flag: --${name}`)
        schema = schema.optional()
        shape[paramName] = schema
      } else {
        // option type - string value
        let schema: z.ZodType
        if (flag.options && flag.options.length > 0) {
          schema = z.enum(flag.options as [string, ...string[]])
        } else {
          schema = z.string()
        }
        schema = schema.describe(flag.description || `Option: --${name}`)
        schema = schema.optional()
        shape[paramName] = schema
      }
    }
  }

  return shape
}

/**
 * Convert a kebab-case or camelCase name to snake_case.
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/-/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * Convert a snake_case param name back to kebab-case flag name.
 */
function snakeCaseToKebab(name: string): string {
  return name.replace(/_/g, '-')
}

/**
 * Shell-escape a string value for safe inclusion in a command.
 */
function shellEscape(value: string): string {
  // If the value contains special characters, wrap in single quotes
  // and escape any single quotes within
  if (/[^a-zA-Z0-9_\-./:@=]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  return value
}

/**
 * Build a CLI command string from a command definition and params.
 */
function buildCommandString(
  command: Command.Cached,
  params: Record<string, unknown>,
): string {
  const parts: string[] = ['prlt', ...commandIdToCliArgs(command.id).split(' ')]

  // Separate arg names from flag names
  const argNames = new Set(
    Object.keys(command.args || {}).map(toSnakeCase),
  )
  const flagDefs = command.flags || {}

  // Add positional args first (in definition order)
  if (command.args) {
    for (const [name] of Object.entries(command.args)) {
      const paramName = toSnakeCase(name)
      const value = params[paramName]
      if (value !== undefined && value !== null && value !== '') {
        parts.push(shellEscape(String(value)))
      }
    }
  }

  // Add flags
  for (const [paramName, value] of Object.entries(params)) {
    // Skip args (already handled) and undefined values
    if (argNames.has(paramName) || value === undefined || value === null) continue

    const flagName = snakeCaseToKebab(paramName)

    // Look up the original flag definition
    const flagDef = flagDefs[flagName]
    if (!flagDef) continue

    if (flagDef.type === 'boolean') {
      if (value === true) {
        parts.push(`--${flagName}`)
      }
    } else {
      // option type
      parts.push(`--${flagName}`, shellEscape(String(value)))
    }
  }

  // Always add --json for structured output if the command supports it
  const hasJsonFlag = 'json' in flagDefs || 'machine' in flagDefs
  if (hasJsonFlag) {
    parts.push('--json')
  }

  return parts.join(' ')
}

/**
 * Check if a command should be excluded from auto-generation.
 */
function isExcluded(command: Command.Cached): boolean {
  // Explicit exclusion list
  if (EXCLUDED_COMMANDS.has(command.id)) return true

  // Exclude hidden commands
  if (command.hidden) return true

  return false
}

/**
 * Register auto-generated MCP tools from oclif command definitions.
 *
 * @param server - MCP server instance
 * @param ctx - MCP tool context
 * @param commands - Array of oclif command definitions from config.commands
 * @param overrideNames - Set of tool names that have manual overrides (skip generation)
 */
export function registerAutoGeneratedTools(
  server: McpServer,
  ctx: McpToolContext,
  commands: Command.Cached[],
  overrideNames: Set<string>,
): void {
  for (const command of commands) {
    const toolName = commandIdToToolName(command.id)

    // Skip if override exists
    if (overrideNames.has(toolName)) continue

    // Skip excluded commands
    if (isExcluded(command)) continue

    // Build Zod schema from command metadata
    const schema = buildZodSchema(command)

    // Register the tool
    strictTool(
      server,
      toolName,
      command.description || `Run: prlt ${commandIdToCliArgs(command.id)}`,
      schema,
      async (params) => {
        try {
          const cmdString = buildCommandString(command, params)
          const output = ctx.runCommand(cmdString)
          return textResponse(output)
        } catch (error) {
          return errorResponse(error)
        }
      },
    )
  }
}
