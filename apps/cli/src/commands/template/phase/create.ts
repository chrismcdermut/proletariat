import { Args, Command, Flags } from '@oclif/core';

export default class TemplatePhaseCreate extends Command {
  static description = 'Create a new phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Phases"',
    '<%= config.bin %> <%= command.id %> "Sprint Phases" --description "Agile sprint phases"',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new template',
      required: true,
    }),
  };

  static flags = {
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplatePhaseCreate);

    const cmdArgs: string[] = [args.name];
    if (flags.description) cmdArgs.push('--description', flags.description);

    await this.config.runCommand('phase:template:create', cmdArgs);
  }
}
