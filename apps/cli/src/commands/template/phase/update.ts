import { Args, Command, Flags } from '@oclif/core';

export default class TemplatePhaseUpdate extends Command {
  static description = 'Update an existing phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-template --description "Updated description"',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to update',
      required: false,
    }),
  };

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'New template name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplatePhaseUpdate);

    const cmdArgs: string[] = [];
    if (args.id) cmdArgs.push(args.id);
    if (flags.name) cmdArgs.push('--name', flags.name);
    if (flags.description) cmdArgs.push('--description', flags.description);

    await this.config.runCommand('phase:template:update', cmdArgs);
  }
}
