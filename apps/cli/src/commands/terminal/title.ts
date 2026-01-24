import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { setTerminalTitle, resetTerminalTitle } from '../../lib/terminal.js';
import { styles } from '../../lib/styles.js';

export default class TerminalTitle extends Command {
  static description = 'Set the terminal tab/window title';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Name"',
    '<%= config.bin %> <%= command.id %>  # Interactive prompt',
    '<%= config.bin %> <%= command.id %> --reset',
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
      const response = await inquirer.prompt<{ title: string }>([{
        type: 'input',
        name: 'title',
        message: 'Enter terminal title:',
        validate: (input: string) => input.length > 0 || 'Title cannot be empty',
      }]);
      title = response.title;
    }

    // Set the title
    setTerminalTitle(title);
    this.log(styles.success(`Terminal title set to "${title}"`));
  }
}
