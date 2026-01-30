/**
 * FlagResolver - Unified flag resolution for human and machine modes
 *
 * This abstraction treats both interactive prompts and JSON mode as "flag producers".
 * Commands declare what flags they need, and the resolver handles obtaining values
 * through either:
 * - CLI flags (already provided by user)
 * - Interactive prompts (TTY mode)
 * - JSON schema output (non-TTY/--json mode)
 *
 * The execution logic only sees the resulting flags, not how they were obtained.
 *
 * @example
 * ```typescript
 * const resolver = new FlagResolver({
 *   commandName: 'ticket create',
 *   baseCommand: 'prlt ticket create',
 *   flags,
 * })
 *
 * const result = await resolver
 *   .define({
 *     name: 'column',
 *     type: 'string',
 *     promptType: 'list',
 *     message: 'Select column:',
 *     choices: async () => columns.map(c => ({ name: c, value: c })),
 *     required: true,
 *   })
 *   .define({
 *     name: 'title',
 *     type: 'string',
 *     message: 'Ticket title:',
 *     required: true,
 *     when: (ctx) => !!ctx.resolved.column,  // Only ask after column is selected
 *   })
 *   .resolve()
 *
 * if (!result.complete) {
 *   // JSON mode - prompt was output, command should exit
 *   return
 * }
 *
 * // Use resolved flags
 * const { column, title } = result.values
 * ```
 */

import inquirer from 'inquirer'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
  normalizeChoices,
  type PromptChoice,
} from '../prompt-json.js'
import type {
  FlagDefinition,
  FlagResolverOptions,
  FlagValue,
  FlagChoice,
  ResolverContext,
  ResolvedFlags,
  PromptType,
} from './types.js'

/**
 * Convert camelCase to kebab-case for CLI flag format
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Build a CLI flag argument string
 */
function buildFlagArg(flagName: string, flagArg?: string): string {
  return flagArg ?? `--${toKebabCase(flagName)}`
}

/**
 * Build command string with resolved flags
 */
function buildCommandWithFlags(
  baseCommand: string,
  resolved: Record<string, FlagValue>,
  definitions: Map<string, FlagDefinition>
): string {
  const parts = [baseCommand]

  for (const [name, value] of Object.entries(resolved)) {
    if (value === undefined) continue

    const def = definitions.get(name)
    const flagArg = buildFlagArg(name, def?.flagArg)

    if (typeof value === 'boolean') {
      if (value) parts.push(flagArg)
    } else if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(flagArg, `"${v}"`)
      }
    } else {
      // String value - quote if contains spaces
      const quoted = value.includes(' ') ? `"${value}"` : value
      parts.push(flagArg, quoted)
    }
  }

  return parts.join(' ')
}

/**
 * Determine the prompt type based on flag definition
 */
function getPromptType(def: FlagDefinition): PromptType {
  if (def.promptType) return def.promptType
  if (def.choices) return 'list'
  if (def.type === 'boolean') return 'confirm'
  if (def.type === 'array') return 'checkbox'
  return 'input'
}

/**
 * FlagResolver class - resolves missing flags via prompts or JSON output
 */
export class FlagResolver<T extends Record<string, FlagValue> = Record<string, FlagValue>> {
  private commandName: string
  private baseCommand: string
  private cliFlags: Record<string, unknown>
  private jsonMode: boolean
  private definitions: Map<string, FlagDefinition> = new Map()
  private resolved: Record<string, FlagValue>

  constructor(options: FlagResolverOptions) {
    this.commandName = options.commandName
    this.baseCommand = options.baseCommand
    this.cliFlags = options.flags
    this.jsonMode = options.jsonMode ?? shouldOutputJson(options.flags as { json?: boolean })
    this.resolved = { ...options.initialValues }
  }

  /**
   * Define a flag to be resolved
   *
   * @param definition Flag definition
   * @returns this (for chaining)
   */
  define<V extends FlagValue>(definition: FlagDefinition<V>): this {
    this.definitions.set(definition.name, definition as unknown as FlagDefinition)
    return this
  }

  /**
   * Define multiple flags at once
   *
   * @param definitions Array of flag definitions
   * @returns this (for chaining)
   */
  defineAll(definitions: FlagDefinition[]): this {
    for (const def of definitions) {
      this.define(def)
    }
    return this
  }

  /**
   * Get the current resolver context
   */
  private getContext(): ResolverContext {
    return {
      resolved: { ...this.resolved },
      cliFlags: this.cliFlags,
    }
  }

  /**
   * Get the current command with all resolved flags
   */
  private getCommandWithFlags(): string {
    return buildCommandWithFlags(this.baseCommand, this.resolved, this.definitions)
  }

  /**
   * Check if a flag value is already available (from CLI or initial values)
   */
  private hasValue(name: string): boolean {
    // Check CLI flags first
    if (this.cliFlags[name] !== undefined) {
      return true
    }
    // Then check resolved values (from initial values)
    if (this.resolved[name] !== undefined) {
      return true
    }
    return false
  }

  /**
   * Get the value for a flag from CLI args or initial values
   */
  private getValue(name: string): FlagValue {
    // CLI flags take precedence
    if (this.cliFlags[name] !== undefined) {
      return this.cliFlags[name] as FlagValue
    }
    return this.resolved[name]
  }

  /**
   * Resolve a single flag definition
   * Returns true if resolution should continue, false if JSON output was emitted
   */
  private async resolveOne(def: FlagDefinition): Promise<boolean> {
    const ctx = this.getContext()

    // Check 'when' condition
    if (def.when) {
      const shouldResolve = await def.when(ctx)
      if (!shouldResolve) {
        // Skip this flag
        return true
      }
    }

    // Check if value is already available
    if (this.hasValue(def.name)) {
      this.resolved[def.name] = this.getValue(def.name)
      return true
    }

    // Check if there's a default value
    if (def.default !== undefined) {
      const defaultVal = typeof def.default === 'function'
        ? await def.default(ctx)
        : def.default
      // Only use default if the flag isn't required
      if (!def.required) {
        this.resolved[def.name] = defaultVal
        return true
      }
    }

    // Flag needs to be prompted for
    const promptType = getPromptType(def)
    const message = typeof def.message === 'function' ? def.message(ctx) : def.message

    // Get choices if applicable
    let choices: FlagChoice[] | undefined
    if (def.choices) {
      choices = typeof def.choices === 'function'
        ? await def.choices(ctx)
        : def.choices
    }

    // Build command with current resolved flags for JSON mode
    const currentCmd = this.getCommandWithFlags()
    const flagArg = buildFlagArg(def.name, def.flagArg)

    // In JSON mode, output the prompt and exit
    if (this.jsonMode) {
      // Build choices with command field for AI agents
      const jsonChoices = choices?.map(c => ({
        name: c.name,
        value: c.value,
        disabled: c.disabled,
        command: c.command ?? `${currentCmd} ${flagArg} "${c.value}" --json`,
      }))

      // Get context for JSON output
      const context = typeof def.context === 'function'
        ? def.context(ctx)
        : def.context

      // Build prompt config based on type
      let promptConfig
      if (promptType === 'input' || promptType === 'editor') {
        // For input prompts, provide hint about how to supply the value
        promptConfig = buildPromptConfig(
          promptType,
          def.name,
          message,
          undefined,
          typeof def.default === 'function' ? await def.default(ctx) : def.default
        )
        promptConfig.context = {
          ...context,
          hint: `Provide with: ${currentCmd} ${flagArg} "YOUR_VALUE"`,
          flagArg,
          currentCommand: currentCmd,
        }
      } else if (promptType === 'confirm') {
        promptConfig = buildPromptConfig('confirm', def.name, message)
        promptConfig.context = {
          ...context,
          hint: `Set with: ${currentCmd} ${flagArg}`,
          flagArg,
          currentCommand: currentCmd,
        }
      } else {
        // list or checkbox
        promptConfig = buildPromptConfig(
          promptType,
          def.name,
          message,
          jsonChoices as PromptChoice[],
          typeof def.default === 'function' ? await def.default(ctx) : def.default
        )
        if (context) {
          promptConfig.context = context
        }
      }

      outputPromptAsJson(promptConfig, createMetadata(this.commandName, this.cliFlags))
      // outputPromptAsJson never returns (calls process.exit)
      return false
    }

    // Interactive mode - prompt for the value
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inquirerPrompt: any = {
      type: promptType === 'editor' ? 'editor' : promptType,
      name: def.name,
      message,
    }

    if (choices) {
      inquirerPrompt.choices = choices.map(c => ({
        name: c.name,
        value: c.value,
        disabled: c.disabled,
      }))
    }

    if (def.default !== undefined) {
      inquirerPrompt.default = typeof def.default === 'function'
        ? await def.default(ctx)
        : def.default
    }

    if (def.validate) {
      inquirerPrompt.validate = async (input: FlagValue) => {
        const result = await def.validate!(input as never, this.getContext())
        return result === true ? true : result
      }
    }

    const answers = await inquirer.prompt([inquirerPrompt])
    this.resolved[def.name] = answers[def.name]

    return true
  }

  /**
   * Resolve all defined flags
   *
   * In JSON mode: outputs the first missing required flag's prompt and exits
   * In interactive mode: prompts for all missing values
   *
   * @returns Resolution result with flag values
   */
  async resolve(): Promise<ResolvedFlags<T>> {
    // Sort definitions by priority (lower = earlier)
    const sortedDefs = [...this.definitions.values()].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    )

    for (const def of sortedDefs) {
      // eslint-disable-next-line no-await-in-loop
      const shouldContinue = await this.resolveOne(def)
      if (!shouldContinue) {
        // JSON mode - prompt was output
        return {
          values: this.resolved as T,
          complete: false,
          commandWithFlags: this.getCommandWithFlags(),
        }
      }
    }

    return {
      values: this.resolved as T,
      complete: true,
      commandWithFlags: this.getCommandWithFlags(),
    }
  }

  /**
   * Resolve a single flag by name
   * Useful for resolving flags in a specific order
   *
   * @param name Flag name to resolve
   * @returns true if resolution should continue, false if JSON output was emitted
   */
  async resolveFlag(name: string): Promise<boolean> {
    const def = this.definitions.get(name)
    if (!def) {
      throw new Error(`Flag definition not found: ${name}`)
    }
    return this.resolveOne(def)
  }

  /**
   * Check if running in JSON mode
   */
  isJsonMode(): boolean {
    return this.jsonMode
  }

  /**
   * Get the current resolved values
   */
  getResolvedValues(): Partial<T> {
    return { ...this.resolved } as Partial<T>
  }

  /**
   * Manually set a resolved value
   * Useful for values obtained through other means (e.g., lookups)
   */
  setValue(name: string, value: FlagValue): this {
    this.resolved[name] = value
    return this
  }

  /**
   * Get the command metadata for JSON output
   */
  getMetadata() {
    return createMetadata(this.commandName, this.cliFlags)
  }
}

// Re-export types for convenience
export type {
  FlagDefinition,
  FlagResolverOptions,
  FlagValue,
  FlagChoice,
  ResolverContext,
  ResolvedFlags,
  PromptType,
} from './types.js'
