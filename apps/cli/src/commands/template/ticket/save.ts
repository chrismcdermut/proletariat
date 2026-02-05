import { Args, Command, Flags } from '@oclif/core';
import { machineOutputFlags } from '../../../lib/pmo/base-command.js';

export default class TemplateTicketSave extends Command {
  static description = 'Create a template from an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Bug Report Template"',
    '<%= config.bin %> <%= command.id %> TKT-042 "Feature Request" --description "Standard feature request template"',
    '<%= config.bin %> <%= command.id %> TKT-001 --template-name "My Template" --json',
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
    ...machineOutputFlags,
    'template-name': Flags.string({
      char: 'n',
      description: 'Template name (alternative to positional arg, required in non-TTY/JSON mode)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateTicketSave);

    const cmdArgs: string[] = [];
    if (args.ticket) cmdArgs.push(args.ticket);
    if (args.name) cmdArgs.push(args.name);
    if (flags['template-name']) cmdArgs.push('--template-name', flags['template-name']);
    if (flags.description) cmdArgs.push('--description', flags.description);
    if (flags.json) cmdArgs.push('--json');
    if (flags.machine) cmdArgs.push('--machine');

    await this.config.runCommand('ticket:template:save', cmdArgs);
  }
}
