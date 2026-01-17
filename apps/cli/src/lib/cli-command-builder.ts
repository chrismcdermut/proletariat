/**
 * CLI Command Builder
 *
 * Tracks user selections during interactive flows and generates
 * the equivalent CLI command with flags for scripting/automation.
 */

/**
 * Represents a flag or argument to include in the CLI command
 */
interface CommandPart {
  /** The flag name (without leading dashes) or 'arg' for positional arguments */
  type: 'flag' | 'arg'
  /** The flag name (e.g., 'mode', 'action') or positional value */
  name: string
  /** The value for the flag (undefined for boolean flags) */
  value?: string | boolean
}

/**
 * CLI Command Builder
 *
 * Tracks selections during an interactive flow and generates
 * the equivalent CLI command string.
 *
 * @example
 * ```ts
 * const builder = new CLICommandBuilder('prlt work spawn')
 * builder.addArg('TKT-419')
 * builder.addFlag('action', 'implement')
 * builder.addFlag('mode', 'devcontainer')
 * builder.addBooleanFlag('create-pr')
 *
 * console.log(builder.toString())
 * // Output: prlt work spawn TKT-419 --action implement --mode devcontainer --create-pr
 * ```
 */
export class CLICommandBuilder {
  private baseCommand: string
  private parts: CommandPart[] = []

  /**
   * Create a new CLI command builder
   * @param baseCommand - The base command (e.g., 'prlt work spawn')
   */
  constructor(baseCommand: string) {
    this.baseCommand = baseCommand
  }

  /**
   * Add a positional argument
   * @param value - The argument value
   */
  addArg(value: string): this {
    this.parts.push({ type: 'arg', name: value })
    return this
  }

  /**
   * Add multiple positional arguments
   * @param values - The argument values
   */
  addArgs(values: string[]): this {
    for (const value of values) {
      this.addArg(value)
    }
    return this
  }

  /**
   * Add a flag with a value
   * @param name - The flag name (without leading dashes)
   * @param value - The flag value
   */
  addFlag(name: string, value: string | number): this {
    this.parts.push({ type: 'flag', name, value: String(value) })
    return this
  }

  /**
   * Add a boolean flag (no value)
   * @param name - The flag name (without leading dashes)
   */
  addBooleanFlag(name: string): this {
    this.parts.push({ type: 'flag', name, value: true })
    return this
  }

  /**
   * Conditionally add a flag if the value is truthy
   * @param name - The flag name
   * @param value - The flag value (only added if truthy)
   */
  addFlagIf(name: string, value: string | number | undefined | null): this {
    if (value !== undefined && value !== null && value !== '') {
      this.addFlag(name, value)
    }
    return this
  }

  /**
   * Conditionally add a boolean flag if the condition is true
   * @param name - The flag name
   * @param condition - Whether to add the flag
   */
  addBooleanFlagIf(name: string, condition: boolean | undefined): this {
    if (condition) {
      this.addBooleanFlag(name)
    }
    return this
  }

  /**
   * Check if a flag has already been added
   * @param name - The flag name to check
   */
  hasFlag(name: string): boolean {
    return this.parts.some(p => p.type === 'flag' && p.name === name)
  }

  /**
   * Get the current count of parts (args + flags)
   */
  get count(): number {
    return this.parts.length
  }

  /**
   * Build the CLI command string
   * @returns The complete CLI command string
   */
  toString(): string {
    const parts: string[] = [this.baseCommand]

    // Add positional arguments first
    for (const part of this.parts) {
      if (part.type === 'arg') {
        // Quote arguments that contain spaces
        const value = part.name.includes(' ') ? `"${part.name}"` : part.name
        parts.push(value)
      }
    }

    // Add flags
    for (const part of this.parts) {
      if (part.type === 'flag') {
        if (part.value === true) {
          // Boolean flag
          parts.push(`--${part.name}`)
        } else if (typeof part.value === 'string') {
          // Value flag - quote values with spaces
          const value = part.value.includes(' ') ? `"${part.value}"` : part.value
          parts.push(`--${part.name}`, value)
        }
      }
    }

    return parts.join(' ')
  }

  /**
   * Create a copy of this builder
   */
  clone(): CLICommandBuilder {
    const clone = new CLICommandBuilder(this.baseCommand)
    clone.parts = [...this.parts]
    return clone
  }
}

/**
 * Format a CLI command for display with styling
 * @param command - The CLI command string
 * @returns Formatted command string for terminal display
 */
export function formatCLICommand(command: string): string {
  // Simple box drawing for visibility
  const line = '─'.repeat(Math.min(command.length + 4, 80))
  return `\n┌${line}┐\nEquivalent CLI command:\n\n  ${command}\n\n└${line}┘`
}

/**
 * Get a shorter formatted version for inline display
 * @param command - The CLI command string
 */
export function formatCLICommandInline(command: string): string {
  return `Equivalent command: ${command}`
}
