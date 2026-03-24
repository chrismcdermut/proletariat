/**
 * MCP Tool Auto-Generator
 *
 * Generates MCP tools from oclif command definitions automatically.
 * Each generated tool invokes the CLI command via ctx.runCommand(),
 * ensuring all operations go through the provider adapter.
 *
 * This eliminates:
 * - Manual drift between CLI commands and MCP tools
 * - Direct ctx.storage access (bypassing provider adapter)
 * - Duplicate flag/arg definitions in Zod
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from './types.js'
import { strictTool, textResponse, errorResponse } from './helpers.js'

// ---------------------------------------------------------------------------
// Types — structural matches for oclif metadata (avoids tight coupling to
// @oclif/core internal types which vary across major versions)
// ---------------------------------------------------------------------------

/** Oclif cached flag metadata */
interface OclifFlag {
  name: string
  type: 'boolean' | 'option'
  char?: string
  description?: string
  required: boolean
  hidden?: boolean
  multiple: boolean
  default?: unknown
  options?: string[]
}

/** Oclif cached arg metadata */
interface OclifArg {
  name: string
  description?: string
  required: boolean
  hidden?: boolean
  default?: unknown
  options?: string[]
}

/** Oclif command metadata (subset of Command.Loadable) */
export interface OclifCommand {
  id: string
  description?: string
  hidden: boolean
  aliases: string[]
  args: Record<string, OclifArg>
  flags: Record<string, OclifFlag>
  pluginName?: string
  pluginType?: string
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Commands excluded from auto-generation (by command ID) */
export const EXCLUDED_COMMANDS = new Set([
  'mcp-server',       // Would be recursive
])

/** Plugins whose commands are excluded from auto-generation */
export const EXCLUDED_PLUGINS = new Set([
  '@oclif/plugin-help',
  '@oclif/plugin-autocomplete',
  '@oclif/plugin-commands',
  '@oclif/plugin-plugins',
])

/** Flags handled automatically — not exposed as tool parameters */
const AUTO_HANDLED_FLAGS = new Set(['json', 'machine', 'help'])

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/**
 * Convert oclif command ID to MCP tool name.
 * "ticket:list" → "ticket_list"
 * "agent:staff:add" → "agent_staff_add"
 * "mcp-server" → "mcp_server"
 */
export function commandIdToToolName(id: string): string {
  return id.replace(/[: -]/g, '_')
}

/**
 * Convert CLI flag name to MCP parameter name.
 * "group-by" → "group_by"
 */
function flagNameToParamName(name: string): string {
  return name.replace(/-/g, '_')
}

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

/**
 * Build a Zod schema shape from oclif command metadata.
 * Positional args come first, then flags.
 */
function buildSchema(cmd: OclifCommand): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}

  // Positional args (in definition order)
  for (const [name, arg] of Object.entries(cmd.args)) {
    if (arg.hidden) continue

    let schema: z.ZodTypeAny
    if (arg.options?.length) {
      schema = z.enum(arg.options as [string, ...string[]])
    } else {
      schema = z.string()
    }

    if (arg.description) {
      schema = schema.describe(arg.description)
    }

    if (!arg.required) {
      schema = schema.optional()
    }

    shape[name] = schema
  }

  // Flags
  for (const [name, flag] of Object.entries(cmd.flags)) {
    if (AUTO_HANDLED_FLAGS.has(name)) continue
    if (flag.hidden) continue

    const paramName = flagNameToParamName(name)

    let schema: z.ZodTypeAny
    if (flag.type === 'boolean') {
      schema = z.boolean()
    } else if (flag.options?.length) {
      schema = z.enum(flag.options as [string, ...string[]])
    } else if (flag.multiple) {
      schema = z.array(z.string())
    } else {
      schema = z.string()
    }

    if (flag.description) {
      schema = schema.describe(flag.description)
    }

    if (!flag.required) {
      schema = schema.optional()
    }

    shape[paramName] = schema
  }

  return shape
}

// ---------------------------------------------------------------------------
// Command string builder
// ---------------------------------------------------------------------------

/**
 * Shell-escape a value for safe command-line usage.
 */
function shellEscape(value: string): string {
  if (/[^a-zA-Z0-9._\-/=@:,+]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  return value
}

/**
 * Build a CLI command string from MCP tool parameters.
 *
 * Example: "prlt ticket list --column Backlog --json"
 */
function buildCommandString(
  commandId: string,
  cmd: OclifCommand,
  params: Record<string, unknown>,
): string {
  // Start with prlt + command parts (replace : with space)
  const parts = ['prlt', ...commandId.split(/[: ]/)]

  // Add positional args in definition order
  for (const name of Object.keys(cmd.args)) {
    if (cmd.args[name].hidden) continue
    const value = params[name]
    if (value !== undefined && value !== null && value !== '') {
      parts.push(shellEscape(String(value)))
    }
  }

  // Add flags
  for (const [name, flag] of Object.entries(cmd.flags)) {
    if (AUTO_HANDLED_FLAGS.has(name)) continue
    if (flag.hidden) continue

    const paramName = flagNameToParamName(name)
    const value = params[paramName]
    if (value === undefined || value === null) continue

    const cliFlag = `--${name}`

    if (flag.type === 'boolean') {
      if (value === true) parts.push(cliFlag)
    } else if (flag.multiple && Array.isArray(value)) {
      for (const v of value as string[]) {
        parts.push(cliFlag, shellEscape(String(v)))
      }
    } else {
      parts.push(cliFlag, shellEscape(String(value)))
    }
  }

  // Always request JSON output when the command supports it
  if (cmd.flags.json) {
    parts.push('--json')
  }

  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Determine whether a command should be excluded from auto-generation.
 */
function shouldExclude(cmd: OclifCommand): boolean {
  if (EXCLUDED_COMMANDS.has(cmd.id)) return true
  if (cmd.pluginName && EXCLUDED_PLUGINS.has(cmd.pluginName)) return true
  return false
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register auto-generated MCP tools from oclif commands.
 *
 * For each non-excluded, non-overridden command:
 * 1. Converts flags/args to a Zod input schema
 * 2. Registers an MCP tool whose handler builds a CLI command string
 *    and invokes it via ctx.runCommand()
 * 3. Returns the CLI output as a text response
 *
 * This ensures all operations route through the CLI's provider adapter,
 * eliminating direct storage access from MCP tools.
 */
export function registerAutoGeneratedTools(
  server: McpServer,
  ctx: McpToolContext,
  commands: OclifCommand[],
  overriddenToolNames: Set<string>,
): { registered: string[]; skipped: string[] } {
  const registered: string[] = []
  const skipped: string[] = []

  for (const cmd of commands) {
    if (shouldExclude(cmd)) {
      skipped.push(cmd.id)
      continue
    }

    const toolName = commandIdToToolName(cmd.id)

    // Manual override takes precedence
    if (overriddenToolNames.has(toolName)) {
      skipped.push(cmd.id)
      continue
    }

    const shape = buildSchema(cmd)
    const description = cmd.description || `Run prlt ${cmd.id.replace(/:/g, ' ')}`

    strictTool(server, toolName, description, shape, async (params) => {
      try {
        const cmdStr = buildCommandString(cmd.id, cmd, params as Record<string, unknown>)
        const output = ctx.runCommand(cmdStr)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    })

    registered.push(toolName)
  }

  return { registered, skipped }
}

/**
 * Get the set of oclif commands that should have MCP tools.
 * Used by the drift test to verify coverage.
 */
export function getExpectedMcpToolNames(commands: OclifCommand[]): string[] {
  return commands
    .filter(cmd => !shouldExclude(cmd))
    .map(cmd => commandIdToToolName(cmd.id))
}
