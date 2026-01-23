import { Args, Command, Flags } from '@oclif/core';

export default class TemplateTicketApply extends Command {
  static description = 'Create a new ticket from a template';

  static examples = [
    '<%= config.bin %> <%= command.id %> bug-report',
    '<%= config.bin %> <%= command.id %> feature-request --title "Add dark mode"',
    '<%= config.bin %> <%= command.id %> bug-report --project my-project',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to use',
      required: true,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'p',
      description: 'Project ID or name',
    }),
    title: Flags.string({
      char: 't',
      description: 'Ticket title (overrides template pattern)',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place the ticket in',
    }),
    priority: Flags.string({
      description: 'Priority (overrides template default)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompt for values',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateTicketApply);

    const cmdArgs: string[] = [args.template];
    if (flags.project) cmdArgs.push('--project', flags.project);
    if (flags.title) cmdArgs.push('--title', flags.title);
    if (flags.column) cmdArgs.push('--column', flags.column);
    if (flags.priority) cmdArgs.push('--priority', flags.priority);
    if (flags.interactive) cmdArgs.push('--interactive');
    if (flags.json) cmdArgs.push('--json');

    await this.config.runCommand('ticket:template:apply', cmdArgs);
  }
}
