import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateCreate extends PMOCommand {
  static description = 'Create a new phase template from current workspace phases';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Phases"',
    '<%= config.bin %> <%= command.id %> "Enterprise" --description "Enterprise project lifecycle"',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new template',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateCreate);

    // Get template name - prompt if not provided
    let templateName = args.name;
    if (!templateName) {
      const { name } = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'Template name:',
        validate: (input: string) => input.length > 0 || 'Name is required',
      }]);
      templateName = name;
    }

    // Get description if not provided
    let description = flags.description;
    if (description === undefined) {
      const { desc } = await inquirer.prompt([{
        type: 'input',
        name: 'desc',
        message: 'Description (optional):',
      }]);
      description = desc || undefined;
    }

    const template = await this.storage.savePhaseTemplate(templateName!, description);

    this.log(styles.success(`\nCreated phase template "${styles.emphasis(template.name)}" (${template.id})`));
    this.log(styles.muted(`Saved ${template.phases.length} phases:`));
    for (const phase of template.phases) {
      const defaultBadge = phase.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
    }
  }
}
