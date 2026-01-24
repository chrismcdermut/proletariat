import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

type TemplateType = 'ticket' | 'phase';

export default class TemplateDelete extends PMOCommand {
  static description = 'Delete templates (ticket or phase)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type ticket',
    '<%= config.bin %> <%= command.id %> --type phase',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Template type to delete',
      options: ['ticket', 'phase'],
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TemplateDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // If no type specified, prompt for type first
    let templateType = flags.type as TemplateType | undefined;

    if (!templateType) {
      const typeChoices = [
        { name: 'Ticket templates', value: 'ticket' },
        { name: 'Phase templates', value: 'phase' },
      ];
      const typeMessage = 'Which template type would you like to delete?';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'type', typeMessage, typeChoices),
          createMetadata('template delete', flags)
        );
        return;
      }

      const { selectedType } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedType',
        message: typeMessage,
        choices: typeChoices,
      }]);
      templateType = selectedType;
    }

    // Get custom templates of the selected type
    let templates: Array<{ id: string; name: string }> = [];
    let typeName = '';

    switch (templateType) {
      case 'ticket': {
        typeName = 'ticket';
        const ticketTemplates = await this.storage.listTicketTemplates({ isBuiltin: false });
        templates = ticketTemplates.map(t => ({ id: t.id, name: t.name }));
        break;
      }
      case 'phase': {
        typeName = 'phase';
        const phaseTemplates = await this.storage.listPhaseTemplates({ isBuiltin: false });
        templates = phaseTemplates.map(t => ({ id: t.id, name: t.name }));
        break;
      }
    }

    if (templates.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TEMPLATES', `No custom ${typeName} templates to delete.`, createMetadata('template delete', flags));
        this.exit(1);
      }
      this.log(styles.muted(`\nNo custom ${typeName} templates to delete.`));
      return;
    }

    // Build choices for template selection
    const templateChoices = templates.map(t => ({
      name: t.name,
      value: t.id,
    }));
    const message = `Select ${typeName} templates to delete:`;

    // In JSON mode, output template selection prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('checkbox', 'templateIds', message, templateChoices),
        createMetadata('template delete', flags)
      );
      return;
    }

    // Select templates to delete
    const { selected } = await inquirer.prompt<{ selected: string[] }>([{
      type: 'checkbox',
      name: 'selected',
      message,
      choices: templateChoices,
    }]);

    if (selected.length === 0) {
      this.log(styles.muted('\nNo templates selected.'));
      return;
    }

    // Confirm deletion
    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete ${selected.length} ${typeName} template(s)?`,
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        default: 0,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    // Delete selected templates
    let deleted = 0;
    for (const id of selected) {
      try {
        switch (templateType) {
          case 'ticket':
            // eslint-disable-next-line no-await-in-loop -- Sequential deletes with error handling
            await this.storage.deleteTicketTemplate(id);
            break;
          case 'phase':
            // eslint-disable-next-line no-await-in-loop -- Sequential deletes with error handling
            await this.storage.deletePhaseTemplate(id);
            break;
        }
        deleted++;
      } catch (error) {
        this.warn(`Failed to delete "${id}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.log(styles.success(`\nDeleted ${deleted} ${typeName} template(s)`));
  }
}
