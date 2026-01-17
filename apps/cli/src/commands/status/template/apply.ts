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

export default class StatusTemplateApply extends PMOCommand {
  static description = 'Apply a workflow status template to a project';

  static examples = [
    '<%= config.bin %> <%= command.id %> kanban',
    '<%= config.bin %> <%= command.id %> linear --project my-project',
    '<%= config.bin %> <%= command.id %> bug-smash --force  # Skip confirmation',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to apply',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing statuses)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateApply);
    // This command requires project context
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status template apply', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify template exists
    const template = await this.storage.getTemplate(args.template);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Template not found: ${args.template}\nRun 'prlt status template list' to see available templates.`);
    }

    // Check if project has existing statuses
    const existingStatuses = await this.storage.listStatuses(projectId);
    if (existingStatuses.length > 0 && !flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('confirm', 'confirm', `Apply template "${template.name}" and replace existing ${existingStatuses.length} statuses?`),
          createMetadata('status template apply', flags)
        );
        return;
      }

      const projectName = await this.getProjectName(projectId);
      this.log(styles.warning(`\nProject "${projectName}" has ${existingStatuses.length} existing status(es).`));
      this.log(styles.warning('Applying a template will REPLACE all existing statuses.'));
      this.log('');

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Apply template "${template.name}" and replace existing statuses?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Apply template
    const statuses = await this.storage.applyTemplate(projectId, args.template);

    const appliedProjectName = await this.getProjectName(projectId);
    this.log(styles.success(`\nApplied template "${styles.emphasis(template.name)}" to project "${appliedProjectName}"`));
    this.log(styles.muted(`Created ${statuses.length} statuses:`));
    for (const status of statuses) {
      const defaultBadge = status.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${status.name} [${status.category}]${defaultBadge}`));
    }
  }
}
