import { Args, Flags } from '@oclif/core';
import { setTerminalTitle, resetTerminalTitle } from '../../lib/terminal.js';
import { styles } from '../../lib/styles.js';
import { machineOutputFlags } from '../../lib/pmo/base-command.js';
import { isAgentMode } from '../../lib/prompt-json.js';
import { PromptCommand } from '../../lib/prompt-command.js';

export default class TerminalTitle extends PromptCommand {
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
