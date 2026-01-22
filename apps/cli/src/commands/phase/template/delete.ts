import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class PhaseTemplateDelete extends PMOCommand {
  static description = 'Delete a phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-custom-template',
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to delete',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
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
    const { args, flags } = await this.parse(PhaseTemplateDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase template delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get template - prompt for selection if not provided
    let templateId = args.id;
    if (!templateId) {
      const templates = await this.storage.listPhaseTemplates();
      const deletableTemplates = templates.filter(t => !t.isBuiltin);
      if (deletableTemplates.length === 0) {
        return handleError('NO_TEMPLATES', `No deletable phase templates found (built-in templates cannot be deleted).`);
      }

      const { selectedTemplate } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTemplate',
        message: 'Select a template to delete:',
        choices: deletableTemplates.map(t => ({
          name: `${t.name}${t.description ? ` - ${t.description}` : ''}`,
          value: t.id,
        })),
      }]);
      templateId = selectedTemplate;
    }

    // Verify template exists
    const template = await this.storage.getPhaseTemplate(templateId!);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Phase template not found: ${templateId}`);
    }

    if (template.isBuiltin) {
      return handleError('CANNOT_DELETE_BUILTIN', 'Cannot delete built-in templates');
    }

    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Delete phase template "${template.name}"?`, confirmChoices),
          createMetadata('phase template delete', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete phase template "${template.name}"?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deletePhaseTemplate(templateId!);

    this.log(styles.success(`\nDeleted phase template "${template.name}"`));
  }
}
