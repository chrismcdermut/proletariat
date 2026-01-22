import { Args, Command, Flags } from '@oclif/core';

export default class TemplateWorkflowCreate extends Command {
  static description = 'Create a new workflow template from scratch';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Workflow"',
    '<%= config.bin %> <%= command.id %> "Simple" --statuses "Todo,In Progress,Done"',
    '<%= config.bin %> <%= command.id %> "Kanban" --description "Simple kanban board"',
  ];

  static args = {
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
    statuses: Flags.string({
      char: 's',
      description: 'Comma-separated list of status names (auto-assigns categories)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateWorkflowCreate);

    const cmdArgs: string[] = [];
    if (args.name) cmdArgs.push(args.name);
    if (flags.description) cmdArgs.push('--description', flags.description);
    if (flags.statuses) cmdArgs.push('--statuses', flags.statuses);

    await this.config.runCommand('status:template:create', cmdArgs);
  }
}
