import { Args, Command, Flags } from '@oclif/core';

export default class TemplateTicketDelete extends Command {
  static description = 'Delete a ticket template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template',
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to delete',
      required: true,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateTicketDelete);

    const cmdArgs: string[] = [args.id];
    if (flags.force) cmdArgs.push('--force');
    if (flags.json) cmdArgs.push('--json');

    await this.config.runCommand('ticket:template:delete', cmdArgs);
  }
}
