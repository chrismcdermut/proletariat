import { Command, Flags } from '@oclif/core';

export default class TemplatePhaseList extends Command {
  static description = 'List phase templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    builtin: Flags.boolean({
      description: 'Show only built-in templates',
      exclusive: ['custom'],
    }),
    custom: Flags.boolean({
      description: 'Show only custom templates',
      exclusive: ['builtin'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplatePhaseList);

    const args: string[] = [];
    if (flags.builtin) args.push('--builtin');
    if (flags.custom) args.push('--custom');
    if (flags.json) args.push('--json');

    await this.config.runCommand('phase:template:list', args);
  }
}
