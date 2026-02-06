import { Args, Command, Flags } from '@oclif/core';

export default class TemplateTicketCreate extends Command {
  static description = 'Create a new ticket template from scratch';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Bug Report"',
    '<%= config.bin %> <%= command.id %> "Feature Request" -d "Template for new features"',
    '<%= config.bin %> <%= command.id %> "Task" --title-pattern "[TASK] " --priority P2',
    '<%= config.bin %> <%= command.id %> "Onboarding" --subtask "Setup environment" --subtask "Read docs" --ac "Complete all subtasks"',
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
    'title-pattern': Flags.string({
      description: 'Default title prefix/pattern (e.g., "[BUG] ")',
    }),
    'description-template': Flags.string({
      description: 'Default description template (markdown)',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Default priority (P0, P1, P2, P3)',
    }),
    category: Flags.string({
      char: 'c',
      description: 'Default category (bug, feature, etc.)',
    }),
    subtask: Flags.string({
      description: 'Add a suggested subtask (can be used multiple times)',
      multiple: true,
    }),
    ac: Flags.string({
      description: 'Add an acceptance criterion pattern (can be used multiple times)',
      multiple: true,
    }),
    label: Flags.string({
      char: 'l',
      description: 'Add a default label (can be used multiple times)',
      multiple: true,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateTicketCreate);

    const cmdArgs: string[] = [];
    if (args.name) cmdArgs.push(args.name);
    if (flags.description) cmdArgs.push('--description', flags.description);
    if (flags['title-pattern']) cmdArgs.push('--title-pattern', flags['title-pattern']);
    if (flags['description-template']) cmdArgs.push('--description-template', flags['description-template']);
    if (flags.priority) cmdArgs.push('--priority', flags.priority);
    if (flags.category) cmdArgs.push('--category', flags.category);
    if (flags.subtask) {
      for (const subtask of flags.subtask) {
        cmdArgs.push('--subtask', subtask);
      }
    }
    if (flags.ac) {
      for (const ac of flags.ac) {
        cmdArgs.push('--ac', ac);
      }
    }
    if (flags.label) {
      for (const label of flags.label) {
        cmdArgs.push('--label', label);
      }
    }
    if (flags.json) cmdArgs.push('--json');

    await this.config.runCommand('ticket:template:create', cmdArgs);
  }
}
