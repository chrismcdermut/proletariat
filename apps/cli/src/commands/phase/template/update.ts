import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js';
import { FlagResolver } from '../../../lib/flags/index.js';

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

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase template update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get template ID - prompt for selection if not provided
    let templateId = args.id;
    if (!templateId) {
      const templates = await this.storage.listPhaseTemplates();
      const editableTemplates = templates.filter(t => !t.isBuiltin);
      if (editableTemplates.length === 0) {
        return handleError('NO_EDITABLE_TEMPLATES', 'No editable phase templates found (built-in templates cannot be updated).');
      }

      const idResolver = new FlagResolver<{ id?: string }>({
        commandName: 'phase template update',
        baseCommand: 'prlt phase template update',
        jsonMode,
        flags: {},
      });

      idResolver.addPrompt({
        flagName: 'id',
        type: 'list',
        message: 'Select a template to update:',
        choices: () => editableTemplates.map(t => ({
          name: `${t.name}${t.description ? ` - ${t.description}` : ''}`,
          value: t.id,
        })),
        getCommand: (value) => `prlt phase template update ${value} --json`,
        when: () => true,
      });

      const idResolved = await idResolver.resolve();
      templateId = idResolved.id;
    }

    // If no flags provided, prompt for what to update
    let newName = flags.name;
    let newDescription = flags.description;

    if (!newName && newDescription === undefined) {
      const updateResolver = new FlagResolver<{ name?: string; description?: string }>({
        commandName: 'phase template update',
        baseCommand: `prlt phase template update ${templateId}`,
        jsonMode,
        flags: {},
      });

      updateResolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'New name (leave empty to keep current):',
        when: () => true,
      });

      updateResolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'New description (leave empty to keep current):',
        when: () => true,
      });

      const updateResolved = await updateResolver.resolve();
      if (updateResolved.name) newName = updateResolved.name;
      if (updateResolved.description) newDescription = updateResolved.description;

      if (!newName && !newDescription) {
        this.log(styles.muted('No changes made.'));
        return;
      }
    }

    const changes: { name?: string; description?: string } = {};
    if (newName) changes.name = newName;
    if (newDescription !== undefined) changes.description = newDescription;

    const template = await this.storage.updatePhaseTemplate(templateId!, changes);

    if (jsonMode) {
      outputSuccessAsJson({
        id: template.id,
        name: template.name,
        description: template.description,
      }, createMetadata('phase template update', flags));
      return;
    }

    this.log(styles.success(`\nUpdated phase template "${styles.emphasis(template.name)}"`));
    if (flags.name) {
      this.log(styles.muted(`  Name: ${template.name}`));
    }
    if (flags.description !== undefined) {
      this.log(styles.muted(`  Description: ${template.description || '(none)'}`));
    }
  }
}
