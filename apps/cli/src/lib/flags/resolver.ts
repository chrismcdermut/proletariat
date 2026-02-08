/**
 * FlagResolver - Unified flag resolution for human and machine interactive modes
 *
 * This abstraction unifies the two interaction patterns in the CLI:
 * - Human interactive mode: Uses inquirer prompts, collects input, returns flags
 * - Machine/JSON mode: Outputs prompt schema as JSON, exits for agent to process
 *
 * Both modes use the same underlying pattern: prompts PRODUCE flags.
 * The execution logic only sees flags, not prompt results.
 *
 * @example
 * ```typescript
 * // Define prompts for missing flags
 * const resolver = new FlagResolver({
 *   commandName: 'ticket create',
 *   baseCommand: 'prlt ticket create',
 *   jsonMode: shouldOutputJson(flags),
 *   flags,
 * });
 *
 * // Add prompts - they execute in order, can depend on previously resolved flags
 * resolver.addPrompt({
 *   flagName: 'column',
 *   type: 'list',
 *   message: 'Select column:',
 *   choices: async () => columns.map(c => ({ name: c, value: c })),
 * });
 *
 * resolver.addPrompt({
 *   flagName: 'title',
 *   type: 'input',
 *   message: 'Enter title:',
 *   when: (ctx) => ctx.flags.column !== undefined, // Only after column is selected
 * });
 *
 * // Resolve all missing flags
 * const resolved = await resolver.resolve();
 * // resolved.column and resolved.title are now guaranteed to have values
 * ```
 */

import inquirer from 'inquirer';
import {
  outputPromptAsJson,
  createMetadata,
  PromptChoice,
  PromptConfig,
} from '../prompt-json.js';
import { multiLineInput } from '../multiline-input.js';

/**
 * Context available during prompt resolution
 */
export interface ResolverContext<TFlags = Record<string, unknown>> {
  /** Currently resolved flags (includes original flags + newly resolved) */
  flags: TFlags;
  /** Command args */
  args: Record<string, unknown>;
  /** Command name for metadata */
  commandName: string;
  /** Base command for building follow-up commands (e.g., "prlt ticket create") */
  baseCommand: string;
  /** Project ID if available */
  projectId?: string;
  /** Any additional custom context */
  [key: string]: unknown;
}

/**
 * Choice item for list/checkbox prompts
 */
export interface ResolverChoice<T = string> {
  /** Display text */
  name: string;
  /** Value returned when selected */
  value: T;
  /** Whether this choice is disabled */
  disabled?: boolean | string;
  /** Full CLI command for this choice (for JSON mode) - if not provided, auto-generated */
  command?: string;
}

/**
 * Definition for a single prompt that resolves a flag
 */
export interface PromptDefinition<TValue = unknown, TFlags = Record<string, unknown>> {
  /** The flag name this prompt resolves (e.g., 'column', 'title') */
  flagName: string;

  /** Prompt type. Use 'multiline' for inline multi-line text input (replaces 'editor') */
  type: 'list' | 'checkbox' | 'input' | 'confirm' | 'editor' | 'multiline';

  /** User-facing prompt message */
  message: string | ((ctx: ResolverContext<TFlags>) => string);

  /**
   * Get choices for list/checkbox prompts.
   * Can be async to fetch dynamic data.
   */
  choices?: (ctx: ResolverContext<TFlags>) => Promise<ResolverChoice<TValue>[]> | ResolverChoice<TValue>[];

  /**
   * Default value for the prompt.
   * Can be a function to compute based on context.
   */
  default?: TValue | ((ctx: ResolverContext<TFlags>) => TValue | undefined);

  /**
   * Validation function for input prompts.
   * Return true if valid, or error message string if invalid.
   */
  validate?: (value: TValue, ctx: ResolverContext<TFlags>) => boolean | string;

  /**
   * Conditional function - prompt is skipped if this returns false.
   * Use for prompts that depend on other flags.
   */
  when?: (ctx: ResolverContext<TFlags>) => boolean;

  /**
   * Transform the flag value before storing.
   * Useful for parsing/formatting.
   */
  transform?: (value: TValue, ctx: ResolverContext<TFlags>) => unknown;

  /**
   * For JSON mode: additional context to include in the prompt output.
   * Useful for providing hints, examples, etc.
   */
  context?: Record<string, unknown> | ((ctx: ResolverContext<TFlags>) => Record<string, unknown>);

  /**
   * For JSON mode: generate the command string for a specific choice.
   * If not provided, auto-generates based on flagName and value.
   */
  getCommand?: (value: TValue, ctx: ResolverContext<TFlags>) => string;

  /**
   * Skip auto-generating commands for choices (useful when choices already have custom commands)
   */
  skipAutoCommand?: boolean;
}

/**
 * Options for creating a FlagResolver
 */
export interface FlagResolverOptions<TFlags extends Record<string, unknown>> {
  /** Command name for metadata (e.g., "ticket create") */
  commandName: string;

  /** Base command for building commands (e.g., "prlt ticket create") */
  baseCommand: string;

  /** Whether JSON mode is active */
  jsonMode: boolean;

  /** Initial flags from CLI parsing */
  flags: Partial<TFlags>;

  /** Command args */
  args?: Record<string, unknown>;

  /** Additional custom context */
  context?: Record<string, unknown>;
}

/**
 * Result of flag resolution
 */
export interface ResolveResult<TFlags> {
  /** The fully resolved flags */
  flags: TFlags;
  /** Whether all required prompts were resolved (false if user cancelled) */
  complete: boolean;
}

/**
 * FlagResolver handles unified flag resolution for both human and machine modes.
 *
 * Usage pattern:
 * 1. Create resolver with command info and current flags
 * 2. Add prompt definitions for flags that may need resolution
 * 3. Call resolve() to get complete flags
 *
 * In JSON mode, resolve() outputs the first unresolved prompt and exits.
 * In interactive mode, resolve() prompts for each unresolved flag sequentially.
 */
export class FlagResolver<TFlags extends Record<string, unknown> = Record<string, unknown>> {
  private prompts: PromptDefinition<unknown, TFlags>[] = [];
  private options: FlagResolverOptions<TFlags>;
  private resolvedFlags: Partial<TFlags>;
  private resolverContext: ResolverContext<TFlags>;

  constructor(options: FlagResolverOptions<TFlags>) {
    this.options = options;
    this.resolvedFlags = { ...options.flags };
    this.resolverContext = {
      flags: this.resolvedFlags as TFlags,
      args: options.args || {},
      commandName: options.commandName,
      baseCommand: options.baseCommand,
      ...options.context,
    };
  }

  /**
   * Add a prompt definition for resolving a flag.
   * Prompts are processed in the order they are added.
   */
  addPrompt<TValue = unknown>(prompt: PromptDefinition<TValue, TFlags>): this {
    this.prompts.push(prompt as PromptDefinition<unknown, TFlags>);
    return this;
  }

  /**
   * Add multiple prompt definitions at once.
   */
  addPrompts(prompts: PromptDefinition<unknown, TFlags>[]): this {
    for (const prompt of prompts) {
      this.prompts.push(prompt);
    }
    return this;
  }

  /**
   * Update the context with additional data.
   * Useful for adding computed values that prompts might need.
   */
  setContext(key: string, value: unknown): this {
    this.resolverContext[key] = value;
    return this;
  }

  /**
   * Get current context value
   */
  getContext<T = unknown>(key: string): T | undefined {
    return this.resolverContext[key] as T | undefined;
  }

  /**
   * Check if a flag has a value (not undefined)
   */
  hasFlag(flagName: keyof TFlags): boolean {
    return this.resolvedFlags[flagName] !== undefined;
  }

  /**
   * Get current flag value
   */
  getFlag<K extends keyof TFlags>(flagName: K): TFlags[K] | undefined {
    return this.resolvedFlags[flagName] as TFlags[K] | undefined;
  }

  /**
   * Set a flag value directly (bypasses prompting)
   */
  setFlag<K extends keyof TFlags>(flagName: K, value: TFlags[K]): this {
    this.resolvedFlags[flagName] = value;
    this.resolverContext.flags = this.resolvedFlags as TFlags;
    return this;
  }

  /**
   * Resolve all prompts and return complete flags.
   *
   * In JSON mode: outputs the first unresolved prompt as JSON and exits (never returns).
   * In interactive mode: prompts for each unresolved flag and returns all flags.
   *
   * @returns The fully resolved flags
   */
  async resolve(): Promise<TFlags> {
    for (const prompt of this.prompts) {
      // Check if flag already has a value
      const currentValue = this.resolvedFlags[prompt.flagName as keyof TFlags];
      if (currentValue !== undefined) {
        continue;
      }

      // Check conditional
      if (prompt.when && !prompt.when(this.resolverContext)) {
        continue;
      }

      // Resolve the message if it's a function
      const message = typeof prompt.message === 'function'
        ? prompt.message(this.resolverContext)
        : prompt.message;

      // Get choices if applicable
      let choices: ResolverChoice<unknown>[] | undefined;
      if (prompt.choices) {
        choices = await Promise.resolve(prompt.choices(this.resolverContext));
      }

      // Get default value
      const defaultValue = typeof prompt.default === 'function'
        ? (prompt.default as (ctx: ResolverContext<TFlags>) => unknown)(this.resolverContext)
        : prompt.default;

      if (this.options.jsonMode) {
        // JSON MODE: Output prompt config and exit
        await this.outputJsonPrompt(prompt, message, choices, defaultValue);
        // outputPromptAsJson calls process.exit, so we never reach here
      } else {
        // INTERACTIVE MODE: Prompt for value
        const value = await this.promptInteractive(prompt, message, choices, defaultValue);

        // Transform value if needed
        const finalValue = prompt.transform
          ? prompt.transform(value, this.resolverContext)
          : value;

        // Store resolved flag
        this.resolvedFlags[prompt.flagName as keyof TFlags] = finalValue as TFlags[keyof TFlags];
        this.resolverContext.flags = this.resolvedFlags as TFlags;
      }
    }

    return this.resolvedFlags as TFlags;
  }

  /**
   * Output prompt as JSON for machine mode
   */
  private async outputJsonPrompt(
    prompt: PromptDefinition<unknown, TFlags>,
    message: string,
    choices: ResolverChoice<unknown>[] | undefined,
    defaultValue: unknown
  ): Promise<never> {
    // Build prompt config
    const config: PromptConfig = {
      type: prompt.type,
      name: prompt.flagName,
      message,
    };

    // Add choices with command field
    if (choices) {
      config.choices = choices.map(choice => {
        const promptChoice: PromptChoice = {
          name: choice.name,
          value: String(choice.value),
        };

        if (choice.disabled !== undefined) {
          promptChoice.disabled = Boolean(choice.disabled);
        }

        // Generate command for this choice
        if (choice.command) {
          promptChoice.command = choice.command;
        } else if (!prompt.skipAutoCommand) {
          // Auto-generate command
          promptChoice.command = prompt.getCommand
            ? prompt.getCommand(choice.value, this.resolverContext)
            : this.buildCommand(prompt.flagName, choice.value);
        }

        return promptChoice;
      });
    }

    // Add default value
    if (defaultValue !== undefined) {
      config.default = defaultValue as string | boolean | string[];
    }

    // Add context if provided
    if (prompt.context) {
      config.context = typeof prompt.context === 'function'
        ? prompt.context(this.resolverContext)
        : prompt.context;
    }

    // For input prompts without choices, add helpful context
    if (prompt.type === 'input' && !config.context) {
      config.context = {
        hint: `Provide ${prompt.flagName} with: ${this.buildCommand(prompt.flagName, '<value>')}`,
      };
    }

    // Output and exit
    outputPromptAsJson(
      config,
      createMetadata(this.options.commandName, this.options.flags as Record<string, unknown>)
    );

    // outputPromptAsJson calls process.exit, but TypeScript doesn't know that
    // This line is never reached
    throw new Error('Unreachable');
  }

  /**
   * Prompt for value in interactive mode
   */
  private async promptInteractive(
    prompt: PromptDefinition<unknown, TFlags>,
    message: string,
    choices: ResolverChoice<unknown>[] | undefined,
    defaultValue: unknown
  ): Promise<unknown> {
    // Handle multiline type specially - use our custom multiLineInput
    if (prompt.type === 'multiline') {
      const result = await multiLineInput({
        message,
        default: typeof defaultValue === 'string' ? defaultValue : '',
        validate: prompt.validate
          ? (value) => prompt.validate!(value, this.resolverContext)
          : undefined,
      });

      if (result.cancelled) {
        throw new Error('Input cancelled');
      }

      return result.value;
    }

    // Build inquirer prompt config as a single question object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const question: any = {
      type: prompt.type,
      name: prompt.flagName,
      message,
      default: defaultValue,
    };

    // Add choices for list/checkbox
    if (choices) {
      question.choices = choices.map(c => ({
        name: c.name,
        value: c.value,
        disabled: c.disabled,
      }));
    }

    // Add validation for input
    if (prompt.validate) {
      question.validate = (input: unknown) => {
        return prompt.validate!(input, this.resolverContext);
      };
    }

    // Prompt and return value
    const answers = await inquirer.prompt([question]);
    return answers[prompt.flagName];
  }

  /**
   * Build a command string for a flag value
   */
  private buildCommand(flagName: string, value: unknown): string {
    const { baseCommand } = this.options;

    // Build flags part from currently resolved flags
    let cmd = baseCommand;

    // Add any project flag from context
    const projectId = this.resolverContext.projectId;
    if (projectId && !this.resolvedFlags['project' as keyof TFlags]) {
      cmd += ` -P ${projectId}`;
    }

    // Add resolved flags (except the one we're prompting for)
    for (const [key, val] of Object.entries(this.resolvedFlags)) {
      if (key === flagName || val === undefined || key === 'json') continue;
      if (typeof val === 'boolean') {
        if (val) cmd += ` --${key}`;
      } else if (typeof val === 'string') {
        cmd += ` --${key} "${val}"`;
      } else if (Array.isArray(val)) {
        cmd += ` --${key} "${val.join(',')}"`;
      } else {
        cmd += ` --${key} ${val}`;
      }
    }

    // Add the current flag
    if (typeof value === 'boolean') {
      if (value) cmd += ` --${flagName}`;
    } else if (typeof value === 'string') {
      cmd += ` --${flagName} "${value}"`;
    } else if (value !== undefined) {
      cmd += ` --${flagName} ${value}`;
    }

    // Always add --json at the end
    cmd += ' --json';

    return cmd;
  }
}

/**
 * Convenience function to create a FlagResolver from command context
 */
export function createFlagResolver<TFlags extends Record<string, unknown>>(
  options: FlagResolverOptions<TFlags>
): FlagResolver<TFlags> {
  return new FlagResolver(options);
}

/**
 * Helper to check if we should use JSON mode
 * Re-exported from prompt-json for convenience
 */
export { shouldOutputJson, isMachineOutput } from '../prompt-json.js';
