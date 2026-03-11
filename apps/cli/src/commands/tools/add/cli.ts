import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findHQRoot } from '../../../lib/workspace.js';
import { addCliTool } from '../../../lib/tools/registry.js';
import { checkToolAvailability } from '../../../lib/tools/detect.js';
import { styles } from '../../../lib/styles.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';
import type { CliToolEntry } from '../../../lib/tools/types.js';

export default class ToolsAddCli extends Command {
  static description = 'Register a CLI tool';

  static examples = [
    '<%= config.bin %> tools add cli gh --command gh --detect "which gh" --install "brew install gh"',
    '<%= config.bin %> tools add cli ffmpeg --command ffmpeg',
    '<%= config.bin %> tools add cli aws --command aws --description "AWS CLI"',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the CLI tool',
      required: false,
    }),
  };

  static flags = {
    command: Flags.string({
      description: 'Command to invoke the tool',
    }),
    detect: Flags.string({
      description: 'Shell command to detect if tool is installed',
    }),
    install: Flags.string({
      description: 'Shell command to install the tool',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Human-readable description',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    machine: Flags.boolean({
      char: 'm',
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ToolsAddCli);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let command = flags.command;
    let detect = flags.detect;
    let install = flags.install;
    let description = flags.description;

    if (!name) {
      if (jsonMode) {
        this.error('Name argument is required in JSON mode');
      }
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'CLI tool name:',
        validate: (input: string) => input.trim() ? true : 'Name is required',
      }]);
      name = response.name;
    }

    if (!command) {
      if (jsonMode) {
        this.error('--command is required in JSON mode');
      }
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'command',
        message: 'Command to invoke:',
        default: name,
        validate: (input: string) => input.trim() ? true : 'Command is required',
      }]);
      command = response.command;
    }

    if (!detect && !jsonMode) {
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'detect',
        message: 'Detection command (default: which <command>):',
      }]);
      if (response.detect.trim()) {
        detect = response.detect.trim();
      }
    }

    if (!install && !jsonMode) {
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'install',
        message: 'Install command (optional):',
      }]);
      if (response.install.trim()) {
        install = response.install.trim();
      }
    }

    if (!description && !jsonMode) {
      const response = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
      }]);
      if (response.description.trim()) {
        description = response.description.trim();
      }
    }

    const entry: CliToolEntry = { command: command! };
    if (detect) entry.detect = detect;
    if (install) entry.install = install;
    if (description) entry.description = description;

    addCliTool(hqPath, name!, entry);

    const available = checkToolAvailability(entry);

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, name, type: 'cli', entry, available }, null, 2));
    } else {
      const status = available ? styles.success('(available)') : styles.warning('(not found on system)');
      this.log(`\n${styles.success(`CLI tool '${name}' registered successfully.`)} ${status}\n`);
    }
  }
}
