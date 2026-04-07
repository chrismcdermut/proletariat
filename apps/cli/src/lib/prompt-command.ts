import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import {
  buildArgSchemaEntry,
  buildFlagSchemaFromOclif,
  createMetadata,
  isAgentMode,
  isMachineModeFromArgv,
  isNonTTY,
  outputPromptAsJson,
  outputValidationErrorAsJson,
  normalizeChoices,
  type FlagSchemaEntry,
  type JsonFlags,
  type OclifFlagLike,
  type OclifArgLike,
} from './prompt-json.js';
import { isPlainOutput, plainText } from './styles.js';
import { withSignalSafePrompt } from './signal-handler.js';

/**
 * Lightweight base command with prompt() method for JSON mode support.
 *
 * Extends oclif Command with a drop-in replacement for inquirer.prompt()
 * that works in both interactive and JSON/agent modes. Use this as the
 * base class for commands that need interactive prompts but don't require
 * PMO database context (for PMO commands, use PMOCommand which extends this).
 *
 * Usage:
 * ```typescript
 * import { PromptCommand } from '../../lib/prompt-command.js';
 *
 * export default class MyCommand extends PromptCommand {
 *   async run(): Promise<void> {
 *     const { flags } = await this.parse(MyCommand);
 *     const { selection } = await this.prompt([{
 *       type: 'list',
 *       name: 'selection',
 *       message: 'Pick one:',
 *       choices: items.map(i => ({
 *         name: i.name,
 *         value: i.id,
 *         command: `prlt my-command --selection "${i.id}" --json`,
 *       })),
 *     }], { flags, commandName: 'my-command' });
 *   }
 * }
 * ```
 */
export abstract class PromptCommand extends Command {
  /**
   * TTY-aware log method - strips ANSI codes and emoji in non-TTY mode.
   *
   * Use this instead of this.log() when outputting styled text (chalk colors, emoji prefixes).
   * In TTY mode, outputs styled text as-is. In non-TTY mode, strips ANSI and emoji.
   *
   * @param message - The styled message (may contain ANSI codes and emoji)
   * @param args - Additional arguments passed to this.log()
   */
  protected logPlain(message?: string, ...args: string[]): void {
    if (message === undefined) {
      this.log();
      return;
    }
    if (isPlainOutput()) {
      this.log(plainText(message), ...args);
    } else {
      this.log(message, ...args);
    }
  }

  /**
   * Check if plain output mode is active (non-TTY, PRLT_PLAIN, NO_COLOR).
   * Convenience wrapper for use in commands.
   */
  protected get isPlain(): boolean {
    return isPlainOutput();
  }

  /**
   * Check if running in non-TTY environment.
   * Convenience wrapper for use in commands.
   */
  protected get isNonTTY(): boolean {
    return isNonTTY();
  }

  /**
   * Prompt wrapper - drop-in replacement for inquirer.prompt
   *
   * Works in BOTH modes:
   * - Interactive mode: calls inquirer.prompt normally (human sees menu)
   * - JSON/Agent mode: outputs prompt as structured JSON and exits
   *
   * This is the simplest way to make any inquirer.prompt call work for both humans and agents.
   * Just replace `await inquirer.prompt(questions)` with `await this.prompt(questions, jsonModeConfig)`
   *
   * @param questions - Inquirer question config(s)
   * @param jsonModeConfig - JSON mode configuration (null to disable JSON mode handling)
   * @returns Answers object (only in interactive mode)
   *
   * @example
   * ```typescript
   * // Before (breaks in JSON mode):
   * const { column } = await inquirer.prompt([{
   *   type: 'list',
   *   name: 'column',
   *   message: 'Select column:',
   *   choices: columns.map(c => ({ name: c, value: c })),
   * }]);
   *
   * // After (works in both modes):
   * const { column } = await this.prompt([{
   *   type: 'list',
   *   name: 'column',
   *   message: 'Select column:',
   *   choices: columns.map(c => ({
   *     name: c,
   *     value: c,
   *     command: `prlt ticket move --column "${c}" --json`,
   *   })),
   * }], {
   *   flags,
   *   commandName: 'ticket move',
   * });
   * ```
   */
  protected async prompt<T extends Record<string, unknown>>(
    questions: Array<{
      type: string;
      name: string;
      message: string;
      choices?: Array<
        | string
        | { name: string; value: unknown; disabled?: boolean | string; command?: string }
        | unknown
      >;
      default?: unknown;
      validate?: (input: unknown) => boolean | string;
      when?: boolean | ((answers: Record<string, unknown>) => boolean);
      filter?: (input: unknown) => unknown;
      pageSize?: number;
      [key: string]: unknown;
    }>,
    jsonModeConfig?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
    } | null
  ): Promise<T> {
    // Auto-detect non-TTY: switch to JSON mode when no TTY present
    if (!jsonModeConfig && isNonTTY()) {
      jsonModeConfig = { flags: { json: true }, commandName: this.id ?? 'unknown' };
    }

    // Check for JSON/agent mode
    if (jsonModeConfig && isAgentMode(jsonModeConfig.flags)) {
      // Find first question that should be shown (respecting 'when' conditions)
      const firstQuestion = questions[0];
      if (firstQuestion) {
        // Convert choices to agent-compatible format
        const choices = firstQuestion.choices
          ? normalizeChoices(firstQuestion.choices)
          : undefined;

        outputPromptAsJson(
          {
            type: firstQuestion.type as 'list' | 'checkbox' | 'input' | 'confirm' | 'editor',
            name: firstQuestion.name,
            message: firstQuestion.message,
            choices,
            default: firstQuestion.default as string | boolean | string[] | undefined,
          },
          createMetadata(jsonModeConfig.commandName, jsonModeConfig.flags)
        );
        return {} as T
      }
      return {} as T;
    }

    // Interactive mode: call inquirer with signal-safe wrapper
    return withSignalSafePrompt(() =>
      inquirer.prompt(questions as Parameters<typeof inquirer.prompt>[0]) as Promise<T>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Validation-first JSON error layer (PRLT-1269)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * oclif catch hook — validation-first JSON error layer.
   *
   * Intercepts oclif parse errors (missing required flag/arg, invalid choice,
   * nonexistent flag) and reformats them as a structured validation_error
   * envelope when the command is running in machine/agent mode. This makes
   * every command agent-friendly automatically, with no per-command code.
   *
   * In interactive mode, falls through to the default oclif catch behavior
   * (re-throws the error so the user sees the human-readable message).
   *
   * Subclasses that override catch() should call `await super.catch(err)`.
   */
  protected async catch(err: Error & { exitCode?: number }): Promise<void> {
    if (this.isOclifParseError(err) && isMachineModeFromArgv(this.argv)) {
      this.emitValidationErrorJson(err);
    }
    return super.catch(err as Error & { exitCode?: number; oclif?: object });
  }

  /**
   * Heuristic detector for oclif parse errors.
   *
   * oclif's parser throws subclasses of `CLIParseError` (RequiredArgsError,
   * FailedFlagValidationError, FlagInvalidOptionError, NonExistentFlagsError,
   * UnexpectedArgsError, ArgInvalidOptionError, InvalidArgsSpecError). They
   * are not exported from the public oclif module surface, so we identify
   * them by constructor name plus the presence of the `parse` property that
   * `CLIParseError` adds (the parse context is unique to parse errors).
   */
  protected isOclifParseError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const name = (err as { constructor?: { name?: string } }).constructor?.name ?? ''
    const PARSE_ERROR_NAMES = new Set([
      'CLIParseError',
      'RequiredArgsError',
      'FailedFlagValidationError',
      'FlagInvalidOptionError',
      'NonExistentFlagsError',
      'UnexpectedArgsError',
      'ArgInvalidOptionError',
      'InvalidArgsSpecError',
    ])
    if (PARSE_ERROR_NAMES.has(name)) return true
    // Defensive: any error with a `.parse` context object that has input.flags
    // is almost certainly a CLIParseError subclass.
    const parse = (err as { parse?: { input?: { flags?: unknown } } }).parse
    return Boolean(parse && typeof parse === 'object' && parse.input && 'flags' in (parse.input as object))
  }

  /**
   * Extract a structured (reason, missing[]) tuple from an oclif parse error.
   *
   * - RequiredArgsError → reason="missing_required_args", missing=[arg names]
   * - FailedFlagValidationError → reason="missing_required_flags", missing=[flag names]
   * - FlagInvalidOptionError → reason="invalid_flag_value", missing=[flag name]
   * - ArgInvalidOptionError → reason="invalid_arg_value", missing=[arg name]
   * - NonExistentFlagsError → reason="nonexistent_flags", missing=[flag names]
   * - UnexpectedArgsError → reason="unexpected_args", missing=[]
   *
   * Falls back to parsing the error message when the typed args aren't
   * available (e.g., raw CLIParseError).
   */
  protected classifyParseError(err: Error): { reason: string; missing: string[] } {
    const name = err.constructor?.name ?? ''
    const anyErr = err as Error & {
      args?: Array<{ name?: string }>
      flags?: string[]
      message?: string
    }

    if (name === 'RequiredArgsError') {
      const missing = (anyErr.args ?? [])
        .map((a) => a?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
      return { reason: 'missing_required_args', missing }
    }

    if (name === 'NonExistentFlagsError') {
      return { reason: 'nonexistent_flags', missing: anyErr.flags ?? [] }
    }

    if (name === 'UnexpectedArgsError') {
      return { reason: 'unexpected_args', missing: [] }
    }

    if (name === 'FailedFlagValidationError') {
      // The failed validations are not stored on the error object, so derive
      // missing flag names from the message: `Missing required flag <name>`.
      const missing: string[] = []
      const msg = anyErr.message ?? ''
      const re = /Missing required flag\s+(\S+)/g
      let match: RegExpExecArray | null
      while ((match = re.exec(msg)) !== null) {
        missing.push(match[1])
      }
      return { reason: 'missing_required_flags', missing }
    }

    if (name === 'FlagInvalidOptionError') {
      // Message format: `Expected --<flag>=<value> to be one of: ...`
      const msg = anyErr.message ?? ''
      const match = /Expected --(\S+?)=/.exec(msg)
      return {
        reason: 'invalid_flag_value',
        missing: match ? [match[1]] : [],
      }
    }

    if (name === 'ArgInvalidOptionError') {
      return { reason: 'invalid_arg_value', missing: [] }
    }

    return { reason: 'parse_error', missing: [] }
  }

  /**
   * Build the schema dictionary from this command's static `flags` and
   * `args` definitions, optionally restricted to a subset of names.
   *
   * Combines `flags` and `baseFlags` so flags inherited from a base class
   * (e.g. `pmoBaseFlags`) are still introspectable.
   */
  protected buildSchemaForCommand(restrictTo?: string[]): Record<string, FlagSchemaEntry> {
    const ctor = this.ctor as typeof Command & {
      flags?: Record<string, OclifFlagLike>
      baseFlags?: Record<string, OclifFlagLike>
      args?: Record<string, OclifArgLike>
    }

    const allFlags: Record<string, OclifFlagLike> = {
      ...(ctor.baseFlags ?? {}),
      ...(ctor.flags ?? {}),
    }

    const schema = buildFlagSchemaFromOclif(allFlags)

    // Add arg entries (args are keyed by name, treated like input prompts).
    const args = ctor.args ?? {}
    for (const [name, arg] of Object.entries(args)) {
      if (!arg) continue
      schema[name] = buildArgSchemaEntry(arg)
    }

    if (!restrictTo || restrictTo.length === 0) {
      return schema
    }

    // Restrict to requested names, but always include any arg/flag that exists
    // in the full definition. Unknown names get a placeholder so agents at least
    // see them listed.
    const restricted: Record<string, FlagSchemaEntry> = {}
    for (const name of restrictTo) {
      if (schema[name]) {
        restricted[name] = schema[name]
      } else {
        restricted[name] = { type: 'input' }
      }
    }
    return restricted
  }

  /**
   * Emit a validation_error JSON envelope and exit.
   *
   * This is the terminal step of the validation-first error layer.
   * It uses the catch handler context to derive command name, missing
   * flags, and the schema, then writes a structured envelope.
   */
  protected emitValidationErrorJson(err: Error): never {
    const { reason, missing } = this.classifyParseError(err)
    const commandName = (this.id ?? 'unknown').replace(/:/g, ' ')

    // Restrict the schema to only the relevant flags/args when we have a list,
    // otherwise emit the full schema so agents see the complete contract.
    const schema = this.buildSchemaForCommand(missing.length > 0 ? missing : undefined)

    outputValidationErrorAsJson(
      {
        command: commandName,
        reason,
        message: err.message ?? 'Validation failed',
        missing,
        schema,
      },
      createMetadata(commandName, { json: true }),
    )
  }
}

