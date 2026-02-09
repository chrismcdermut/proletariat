import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import {
  isAgentMode,
  outputPromptAsJson,
  createMetadata,
  normalizeChoices,
  type JsonFlags,
} from './prompt-json.js';

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
    if (!jsonModeConfig && !process.stdin.isTTY) {
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
        // outputPromptAsJson calls process.exit, never returns
      }
      return {} as T;
    }

    // Interactive mode: just call inquirer
    return inquirer.prompt(questions as Parameters<typeof inquirer.prompt>[0]) as Promise<T>;
  }
}
