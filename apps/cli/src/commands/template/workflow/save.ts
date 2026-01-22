import { Args, Command, Flags } from '@oclif/core';

export default class TemplateWorkflowSave extends Command {
  static description = 'Save current project workflow as a reusable template';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Workflow"',
    '<%= config.bin %> <%= command.id %> "Team Workflow" --project my-project',
    '<%= config.bin %> <%= command.id %> "Sprint Board" --description "Agile sprint workflow"',
  ];

  static args = {
    name: Args.string({
      description: 'Template name',
      required: true,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'p',
      description: 'Project ID or name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateWorkflowSave);

    const cmdArgs: string[] = [args.name];
    if (flags.project) cmdArgs.push('--project', flags.project);
    if (flags.description) cmdArgs.push('--description', flags.description);

    await this.config.runCommand('status:template:save', cmdArgs);
  }
}
