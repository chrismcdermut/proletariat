import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { WorkflowTemplate } from '../../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class StatusTemplate extends PMOCommand {
  static description = 'Interactive menu for workflow status template operations';

  static aliases = ['status:templates'];

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
    const { flags } = await this.parse(StatusTemplate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // In JSON mode, output action menu prompt
    if (jsonMode) {
      const actionChoices = [
        { name: 'List available templates', value: 'list' },
        { name: 'Apply template to project', value: 'apply' },
        { name: 'Save current workflow as template', value: 'save' },
        { name: 'Delete template', value: 'delete' },
        { name: 'Cancel', value: 'cancel' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', '📋 Status Templates - What would you like to do?', actionChoices),
        createMetadata('status template', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '📋 Status Templates - What would you like to do?',
      choices: [
        { name: 'List available templates', value: 'list' },
        { name: 'Apply template to project', value: 'apply' },
        { name: 'Save current workflow as template', value: 'save' },
        new inquirer.Separator('──────────────'),
        { name: 'Delete template', value: 'delete' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('status:template:list', []);
        break;
      case 'apply': {
        const templateId = await this.selectTemplate('Select template to apply:');
        if (templateId) {
          await this.config.runCommand('status:template:apply', [templateId]);
        }
        break;
      }
      case 'save': {
        const { name } = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: 'Template name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        }]);
        await this.config.runCommand('status:template:save', [name]);
        break;
      }
      case 'delete': {
        const customTemplates = (await this.storage.listTemplates()).filter(t => !t.isBuiltin);
        if (customTemplates.length === 0) {
          this.log('No custom templates to delete. Built-in templates cannot be deleted.');
          return;
        }
        const templateId = await this.selectTemplate('Select template to delete:', true);
        if (templateId) {
          await this.config.runCommand('status:template:delete', [templateId]);
        }
        break;
      }
    }
  }

  private async selectTemplate(message: string, customOnly = false): Promise<string | null> {
    let templates = await this.storage.listTemplates();
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
