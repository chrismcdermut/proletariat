import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TemplateUpdate extends PMOCommand {
  static description = 'Update a phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-template -d "Updated description"',
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
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TemplateUpdate);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('template update', flags));
      }
      this.error(message);
    };

    // Get template ID
    let templateId = args.id;
    if (!templateId) {
      const templates = await this.storage.listPhaseTemplates();
      const editable = templates.filter(t => !t.isBuiltin);
      if (editable.length === 0) {
        return handleError('NO_TEMPLATES', 'No editable phase templates (built-in cannot be updated).');
      }

      if (jsonMode) {
        const choices = editable.map(t => ({ name: `${t.name}${t.description ? ` - ${t.description}` : ''}`, value: t.id }));
        outputPromptAsJson(buildPromptConfig('list', 'id', 'Select template:', choices), createMetadata('template update', flags));
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select template:',
        choices: editable.map(t => ({ name: `${t.name}${t.description ? ` - ${t.description}` : ''}`, value: t.id })),
      }], null);
      templateId = selected;
    }

    // Get updates
    let newName = flags.name;
    let newDescription = flags.description;

    if (!newName && newDescription === undefined && !jsonMode) {
      const { updateName } = await this.prompt<{ updateName: string }>([{
        type: 'input', name: 'updateName', message: 'New name (leave empty to keep):',
      }], null);
      if (updateName) newName = updateName;

      const { updateDesc } = await this.prompt<{ updateDesc: string }>([{
        type: 'input', name: 'updateDesc', message: 'New description (leave empty to keep):',
      }], null);
      if (updateDesc) newDescription = updateDesc;

      if (!newName && !newDescription) {
        this.log(styles.muted('No changes.'));
        return;
      }
    }

    const changes: { name?: string; description?: string } = {};
    if (newName) changes.name = newName;
    if (newDescription !== undefined) changes.description = newDescription;

    const template = await this.storage.updatePhaseTemplate(templateId!, changes);

    if (jsonMode) {
      outputSuccessAsJson({ template }, createMetadata('template update', flags));
      return;
    }

    this.log(styles.success(`\nUpdated template "${styles.emphasis(template.name)}"`));
  }
}
