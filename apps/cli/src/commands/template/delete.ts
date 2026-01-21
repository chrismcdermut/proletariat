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

export default class TemplateDelete extends PMOCommand {
  static description = 'Delete multiple workflow templates';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

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
    const { flags } = await this.parse(TemplateDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Get only custom templates (can't delete built-in)
    const templates = await this.storage.listTemplates({ isBuiltin: false });

    if (templates.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TEMPLATES', 'No custom templates to delete.', createMetadata('template delete', flags));
        this.exit(1);
      }
      this.log(styles.muted('\nNo custom templates to delete.'));
      return;
    }

    // Build choices once, use for both JSON and interactive modes
    const templateChoices = templates.map(t => ({
      name: `${t.name} (${t.statuses.length} statuses)`,
      value: t.id,
    }));
    const message = 'Select templates to delete:';

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
        message: `Delete ${selected.length} template(s)?`,
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
        await this.storage.deleteTemplate(id);
        deleted++;
      } catch (error) {
        this.warn(`Failed to delete "${id}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.log(styles.success(`\nDeleted ${deleted} template(s)`));
  }
}
