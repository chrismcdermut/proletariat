import { Args, Command, Flags } from '@oclif/core';

export default class TemplateWorkflowApply extends Command {
  static description = 'Apply a workflow template to a project';

  static examples = [
    '<%= config.bin %> <%= command.id %> kanban',
    '<%= config.bin %> <%= command.id %> linear --project my-project',
    '<%= config.bin %> <%= command.id %> kanban --force',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to apply',
      required: true,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'p',
      description: 'Project ID or name',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing statuses)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateWorkflowApply);

    const cmdArgs: string[] = [args.template];
    if (flags.project) cmdArgs.push('--project', flags.project);
    if (flags.force) cmdArgs.push('--force');
    if (flags.json) cmdArgs.push('--json');

    await this.config.runCommand('status:template:apply', cmdArgs);
  }
}
