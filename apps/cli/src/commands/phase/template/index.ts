import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { PhaseTemplate } from '../../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class PhaseTemplateMenu extends PMOCommand {
  static description = 'Interactive menu for project phase template operations';

  static aliases = ['phase:templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(PhaseTemplateMenu);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List available templates', value: 'list' },
      { name: 'Apply template to workspace', value: 'apply' },
      { name: 'Save current phases as template', value: 'create' },
      { name: 'Update template', value: 'update' },
      { name: 'Delete template', value: 'delete' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Phase Templates - What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('phase template', flags)
      );
      return;
    }

    {
      // Show interactive menu
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: '📊 ' + message,
        choices: [
          ...menuChoices.slice(0, 3),
          new inquirer.Separator('──────────────'),
          ...menuChoices.slice(3),
        ],
      }]);

      if (action === 'cancel') {
        return;
      }

      // Run the selected subcommand
      switch (action) {
        case 'list':
          await this.config.runCommand('phase:template:list', []);
          break;
        case 'apply': {
          const templateId = await this.selectTemplate(this.storage, 'Select template to apply:');
          if (templateId) {
            await this.config.runCommand('phase:template:apply', [templateId]);
          }
          break;
        }
        case 'create': {
          const { name } = await inquirer.prompt([{
            type: 'input',
            name: 'name',
            message: 'Template name:',
            validate: (input: string) => input.length > 0 || 'Name is required',
          }]);
          await this.config.runCommand('phase:template:create', [name]);
          break;
        }
        case 'update': {
          const customTemplates = (await this.storage.listPhaseTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log('No custom templates to update. Built-in templates cannot be modified.');
            return;
          }
          const templateId = await this.selectTemplate(this.storage, 'Select template to update:', true);
          if (templateId) {
            await this.config.runCommand('phase:template:update', [templateId]);
          }
          break;
        }
        case 'delete': {
          const customTemplates = (await this.storage.listPhaseTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log('No custom templates to delete. Built-in templates cannot be deleted.');
            return;
          }
          const templateId = await this.selectTemplate(this.storage, 'Select template to delete:', true);
          if (templateId) {
            await this.config.runCommand('phase:template:delete', [templateId]);
          }
          break;
        }
      }
    }
  }

  private async selectTemplate(storage: { listPhaseTemplates: () => Promise<PhaseTemplate[]> }, message: string, customOnly = false): Promise<string | null> {
    let templates = await storage.listPhaseTemplates();
    if (customOnly) {
      templates = templates.filter(t => !t.isBuiltin);
    }

    if (templates.length === 0) {
      this.log('No templates found.');
      return null;
    }

    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message,
      choices: [
        ...templates.map(t => ({
          name: `${t.name} (${t.id})${t.isBuiltin ? '' : ' [custom]'}`,
          value: t.id,
        })),
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
    }]);

    return selected;
  }
}
