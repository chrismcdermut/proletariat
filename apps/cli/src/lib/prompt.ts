/**
 * Interactive prompt utilities with TTY detection for agent-friendly CLI
 *
 * This module provides wrappers around inquirer that:
 * 1. Check if running in a TTY (interactive terminal)
 * 2. Detect devcontainer environments for smart defaults
 * 3. Provide clear error messages with flag instructions when non-interactive
 */

import inquirer, { QuestionCollection, Answers } from 'inquirer';

/**
 * Check if we're running in an interactive terminal
 * Returns false when:
 * - Running in Claude Code (execSync with stdio: 'pipe')
 * - Piped commands (echo "input" | prlt ...)
 * - CI/CD environments
 * - Cron jobs
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * Check if we're running inside a devcontainer
 * Set by devcontainer.json containerEnv
 */
export function isDevcontainer(): boolean {
  return process.env.DEVCONTAINER === 'true';
}

/**
 * Error thrown when a prompt is needed but we're in non-interactive mode
 */
export class NonInteractiveError extends Error {
  constructor(
    message: string,
    public readonly flagHint: string
  ) {
    super(message);
    this.name = 'NonInteractiveError';
  }
}

/**
 * Options for interactive prompts
 */
export interface PromptOptions {
  /** The flag(s) to use when non-interactive. Will be shown in error message. */
  flagHint: string;
  /** Description of what the prompt is asking for (used in error message) */
  description?: string;
}

/**
 * Run inquirer prompts with TTY detection
 *
 * @param questions - inquirer question config
 * @param options - options including flag hint for non-interactive mode
 * @throws NonInteractiveError if not running in TTY
 *
 * @example
 * // Instead of:
 * const { name } = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Name:' }]);
 *
 * // Use:
 * const { name } = await prompt([{ type: 'input', name: 'name', message: 'Name:' }], {
 *   flagHint: '--name "Project Name"',
 *   description: 'project name'
 * });
 */
export async function prompt<T extends Answers>(
  questions: QuestionCollection<T>,
  options: PromptOptions
): Promise<T> {
  if (!isInteractive()) {
    const desc = options.description || 'required input';
    throw new NonInteractiveError(
      `Non-interactive mode detected. Cannot prompt for ${desc}.\nUse: ${options.flagHint}`,
      options.flagHint
    );
  }

  return inquirer.prompt(questions);
}

/**
 * Require a value, prompting only if in interactive mode
 *
 * @param value - The value from flags/args (may be undefined)
 * @param promptConfig - Config for the interactive prompt
 * @param options - Options including flag hint
 * @returns The value (from flag or prompt)
 * @throws NonInteractiveError if value is missing and not in TTY
 *
 * @example
 * // Get project name from --name flag or prompt if interactive
 * const name = await requireOrPrompt(flags.name, {
 *   type: 'input',
 *   name: 'name',
 *   message: 'Project name:',
 *   validate: (input) => input.length > 0 || 'Name is required'
 * }, {
 *   flagHint: '--name "Project Name"',
 *   description: 'project name'
 * });
 */
export async function requireOrPrompt<T>(
  value: T | undefined,
  promptConfig: {
    type: string;
    name: string;
    message: string;
    choices?: unknown[];
    default?: unknown;
    validate?: (input: unknown) => boolean | string;
  },
  options: PromptOptions
): Promise<T> {
  // If value is provided, use it
  if (value !== undefined && value !== null && value !== '') {
    return value;
  }

  // If not interactive, error with flag hint
  if (!isInteractive()) {
    const desc = options.description || promptConfig.name;
    throw new NonInteractiveError(
      `Non-interactive mode detected. Missing ${desc}.\nUse: ${options.flagHint}`,
      options.flagHint
    );
  }

  // Prompt interactively
  const answers = await inquirer.prompt([promptConfig]);
  return answers[promptConfig.name] as T;
}

/**
 * Confirm an action, with a default for non-interactive mode
 *
 * @param message - Confirmation message
 * @param options - Options including default for non-interactive mode
 * @returns true/false
 *
 * @example
 * // Confirm deletion, default to false in non-interactive mode
 * const confirmed = await confirm('Delete this item?', {
 *   nonInteractiveDefault: false,
 *   flagHint: '--force'
 * });
 */
export async function confirm(
  message: string,
  options: {
    /** Default value when in non-interactive mode */
    nonInteractiveDefault: boolean;
    /** Flag hint shown in output when using default */
    flagHint?: string;
    /** Default value for interactive prompt */
    interactiveDefault?: boolean;
  }
): Promise<boolean> {
  if (!isInteractive()) {
    // In non-interactive mode, use the default
    if (options.flagHint && !options.nonInteractiveDefault) {
      // Log a hint about how to force the action
      console.error(`Non-interactive mode: defaulting to ${options.nonInteractiveDefault}. Use ${options.flagHint} to override.`);
    }
    return options.nonInteractiveDefault;
  }

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: options.interactiveDefault ?? options.nonInteractiveDefault,
    },
  ]);

  return confirmed;
}

/**
 * Select from a list of choices, with support for non-interactive mode
 *
 * @param choices - Array of choices
 * @param options - Options including flag hint and optional default
 * @returns Selected value
 *
 * @example
 * const status = await select(
 *   [{ name: 'Todo', value: 'todo' }, { name: 'Done', value: 'done' }],
 *   {
 *     message: 'Select status:',
 *     flagHint: '--status <status>',
 *     description: 'status',
 *     // Optional: provide a default for non-interactive mode
 *     nonInteractiveDefault: 'todo'
 *   }
 * );
 */
export async function select<T>(
  choices: Array<{ name: string; value: T }>,
  options: PromptOptions & {
    message: string;
    /** Default value for non-interactive mode (if not provided, will error) */
    nonInteractiveDefault?: T;
    /** Default value for interactive mode */
    interactiveDefault?: T;
  }
): Promise<T> {
  if (!isInteractive()) {
    if (options.nonInteractiveDefault !== undefined) {
      return options.nonInteractiveDefault;
    }
    const desc = options.description || 'selection';
    const choiceList = choices.map((c) => `  - ${c.value}`).join('\n');
    throw new NonInteractiveError(
      `Non-interactive mode detected. Cannot prompt for ${desc}.\nUse: ${options.flagHint}\n\nAvailable options:\n${choiceList}`,
      options.flagHint
    );
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: options.message,
      choices,
      default: options.interactiveDefault,
    },
  ]);

  return selected;
}

/**
 * Get environment-aware defaults for common values
 * In devcontainer: can make smarter defaults based on context
 */
export function getSmartDefaults(): {
  /** Whether we're in a devcontainer (agent environment) */
  isAgent: boolean;
  /** Suggested timeout for operations (longer in devcontainer) */
  timeout: number;
  /** Whether to skip confirmations by default */
  skipConfirmations: boolean;
} {
  const isAgent = isDevcontainer();
  return {
    isAgent,
    timeout: isAgent ? 300000 : 60000, // 5 min for agents, 1 min for humans
    skipConfirmations: isAgent, // Agents should use flags, not confirmations
  };
}
