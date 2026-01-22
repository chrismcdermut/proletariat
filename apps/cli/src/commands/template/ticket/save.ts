import { Args, Command, Flags } from '@oclif/core';

export default class TemplateTicketSave extends Command {
  static description = 'Create a template from an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Bug Report Template"',
    '<%= config.bin %> <%= command.id %> TKT-042 "Feature Request" --description "Standard feature request template"',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket ID to create template from',
      required: false,
    }),
    name: Args.string({
      description: 'Template name',
      required: false,
    }),
  };

  static flags = {
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateTicketSave);

    const cmdArgs: string[] = [];
    if (args.ticket) cmdArgs.push(args.ticket);
    if (args.name) cmdArgs.push(args.name);
    if (flags.description) cmdArgs.push('--description', flags.description);

    await this.config.runCommand('ticket:template:save', cmdArgs);
  }
}
