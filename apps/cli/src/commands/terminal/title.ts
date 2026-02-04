import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { setTerminalTitle, resetTerminalTitle } from '../../lib/terminal.js';
import { styles } from '../../lib/styles.js';
import { machineOutputFlags } from '../../lib/pmo/base-command.js';
import {
  isAgentMode,
  outputPromptAsJson,
  createMetadata,
  normalizeChoices,
  type JsonFlags,
} from '../../lib/prompt-json.js';

export default class TerminalTitle extends Command {
  static description = 'Set the terminal tab/window title';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Name"',
    '<%= config.bin %> <%= command.id %>  # Interactive prompt',
    '<%= config.bin %> <%= command.id %> --reset',
    '<%= config.bin %> <%= command.id %> --machine  # JSON mode for agents',
  ];

  static args = {
    title: Args.string({
      description: 'Title to set for the terminal tab/window',
      required: false,
    }),
  };

  static flags = {
    reset: Flags.boolean({
      char: 'r',
      description: 'Reset terminal title to default',
      default: false,
    }),
    ...machineOutputFlags,
  };

  /**
   * Prompt wrapper - drop-in replacement for inquirer.prompt with JSON mode support.
   * Matches the pattern from PMOCommand.prompt().
   *
   * In JSON mode: outputs prompt config as JSON and exits
   * In interactive mode: shows normal inquirer prompt
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
    }>,
    jsonModeConfig?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
    } | null
  ): Promise<T> {
    // Check for JSON/agent mode
    if (jsonModeConfig && isAgentMode(jsonModeConfig.flags)) {
      const firstQuestion = questions[0];
      if (firstQuestion) {
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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TerminalTitle);

    // Handle reset flag
    if (flags.reset) {
      resetTerminalTitle();
      this.log(styles.success('Terminal title reset to default'));
      return;
    }

    // Get title from args or prompt
    let title = args.title;

    if (!title) {
      const jsonModeConfig = isAgentMode(flags) ? { flags, commandName: 'terminal title' } : null;

      const response = await this.prompt<{ title: string }>([{
        type: 'input',
        name: 'title',
        message: 'Enter terminal title:',
        validate: (input: unknown) => (typeof input === 'string' && input.length > 0) || 'Title cannot be empty',
      }], jsonModeConfig);
      title = response.title;
    }

    // Set the title
    setTerminalTitle(title);
    this.log(styles.success(`Terminal title set to "${title}"`));
  }
}
