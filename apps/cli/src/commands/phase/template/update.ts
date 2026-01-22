import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateUpdate extends PMOCommand {
  static description = 'Update a phase template';

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
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New template name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New template description',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateUpdate);

    // Get template ID - prompt for selection if not provided
    let templateId = args.id;
    if (!templateId) {
      const templates = await this.storage.listPhaseTemplates();
      const editableTemplates = templates.filter(t => !t.isBuiltin);
      if (editableTemplates.length === 0) {
        this.error('No editable phase templates found (built-in templates cannot be updated).');
      }

      const { selectedTemplate } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTemplate',
        message: 'Select a template to update:',
        choices: editableTemplates.map(t => ({
          name: `${t.name}${t.description ? ` - ${t.description}` : ''}`,
          value: t.id,
        })),
      }]);
      templateId = selectedTemplate;
    }

    // If no flags provided, prompt for what to update
    let newName = flags.name;
    let newDescription = flags.description;

    if (!newName && newDescription === undefined) {
      const { updateName } = await inquirer.prompt([{
        type: 'input',
        name: 'updateName',
        message: 'New name (leave empty to keep current):',
      }]);
      if (updateName) newName = updateName;

      const { updateDesc } = await inquirer.prompt([{
        type: 'input',
        name: 'updateDesc',
        message: 'New description (leave empty to keep current):',
      }]);
      if (updateDesc) newDescription = updateDesc;

      if (!newName && !newDescription) {
        this.log(styles.muted('No changes made.'));
        return;
      }
    }

    const changes: { name?: string; description?: string } = {};
    if (newName) changes.name = newName;
    if (newDescription !== undefined) changes.description = newDescription;

    const template = await this.storage.updatePhaseTemplate(templateId!, changes);

    this.log(styles.success(`\nUpdated phase template "${styles.emphasis(template.name)}"`));
    if (flags.name) {
      this.log(styles.muted(`  Name: ${template.name}`));
    }
    if (flags.description !== undefined) {
      this.log(styles.muted(`  Description: ${template.description || '(none)'}`));
    }
  }
}
