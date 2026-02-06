import { Args, Command, Flags } from '@oclif/core';

export default class TemplatePhaseCreate extends Command {
  static description = 'Create a new phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Phases"',
    '<%= config.bin %> <%= command.id %> "Sprint Phases" --description "Agile sprint phases"',
    '<%= config.bin %> <%= command.id %> "My Phases" --description "Custom phases" --json',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new template',
      required: false,
    }),
  };

  static flags = {
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplatePhaseCreate);

    const cmdArgs: string[] = [];
    if (args.name) cmdArgs.push(args.name);
    if (flags.description) cmdArgs.push('--description', flags.description);
    if (flags.json) cmdArgs.push('--json');

    await this.config.runCommand('phase:template:create', cmdArgs);
  }
}
