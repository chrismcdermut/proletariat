import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class StatusUpdate extends PMOCommand {
  static description = 'Update a workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-in-review --name "Code Review"',
    '<%= config.bin %> <%= command.id %> my-project-blocked --color "#EF4444"',
    '<%= config.bin %> <%= command.id %> my-project-todo --default  # Set as default',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    name: Flags.string({
      char: 'n',
      description: 'New status name',
    }),
    category: Flags.string({
      char: 'c',
      description: 'New category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    color: Flags.string({
      description: 'Hex color code (e.g., #FF0000)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Status description',
    }),
    default: Flags.boolean({
      description: 'Set as default status for new tickets',
      allowNo: true,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusUpdate);
    // This command requires project context
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get the project's workflow ID
    const project = await this.storage.getProject(projectId);
    if (!project?.workflowId) {
      return handleError('NO_WORKFLOW', `Project "${projectId}" has no workflow assigned.`);
    }

    // Get status ID - prompt if not provided
    let statusId = args.id;

    if (!statusId) {
      const statuses = await this.storage.listStatuses(project.workflowId);
      if (statuses.length === 0) {
        return handleError('NO_STATUSES', 'No statuses found. Create a status first with "prlt status create".');
      }

      // In JSON mode, output status selection prompt
      if (jsonMode) {
        const statusChoices = statuses.map(s => ({
          name: `${s.name} (${s.category})`,
          value: s.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select status to update:', statusChoices),
          createMetadata('status update', flags)
        );
        return;
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select status to update:',
        choices: statuses.map(s => ({
          name: `${s.name} (${s.category})`,
          value: s.id,
        })),
      }]);
      statusId = selectedId;
    }

    // Get existing status
    const existing = await this.storage.getStatus(statusId!);
    if (!existing) {
      return handleError('STATUS_NOT_FOUND', `Status not found: ${statusId}`);
    }

    let changes: Partial<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>;

    // Check if any change flags were provided
    const hasChangeFlags = flags.name !== undefined ||
                            flags.category !== undefined ||
                            flags.color !== undefined ||
                            flags.description !== undefined ||
                            flags.default !== undefined;

    // Auto-enter interactive mode if no change flags provided
    if (flags.interactive || !hasChangeFlags) {
      // Build choices once - single source of truth
      const categoryChoices = STATE_CATEGORY_ORDER.map(cat => ({ name: cat, value: cat }));

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Status name:', default: existing.name },
        { type: 'list', name: 'category', message: 'Category:', choices: categoryChoices, default: existing.category },
        { type: 'input', name: 'color', message: 'Color (hex, optional):', default: existing.color || '' },
        { type: 'input', name: 'description', message: 'Description (optional):', default: existing.description || '' },
        { type: 'confirm', name: 'isDefault', message: 'Set as default status for new tickets?', default: existing.isDefault || false },
      ];

      // In JSON mode, output form prompts
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('status update', flags)
        );
      }

      changes = await this.promptChanges(fields, existing);
    } else {
      changes = {};
      if (flags.name !== undefined) changes.name = flags.name;
      if (flags.category !== undefined) changes.category = flags.category as StateCategory;
      if (flags.color !== undefined) changes.color = flags.color;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags.default !== undefined) changes.isDefault = flags.default;
    }

    const updated = await this.storage.updateStatus(statusId!, changes);

    this.log(styles.success(`\nUpdated status "${styles.emphasis(updated.name)}"`));
    this.log(styles.muted(`  ID: ${updated.id}`));
    this.log(styles.muted(`  Category: ${updated.category}`));
    if (updated.color) {
      this.log(styles.muted(`  Color: ${updated.color}`));
    }
    if (updated.isDefault) {
      this.log(styles.muted(`  Default: yes`));
    }
  }

  private async promptChanges(
    fields: FormField[],
    existing: {
      name: string;
      category: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    }
  ): Promise<Partial<{
    name: string;
    category: StateCategory;
    color: string;
    description: string;
    isDefault: boolean;
  }>> {
    // Build inquirer prompts from fields, adding validators
    const answers = await inquirer.prompt<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>(fields.map(field => ({
      ...field,
      validate: field.name === 'name'
        ? ((input: string) => input.length > 0 || 'Name is required')
        : field.name === 'color'
        ? ((input: string) => {
            if (!input) return true;
            return /^#[0-9A-Fa-f]{6}$/.test(input) || 'Invalid hex color (e.g., #FF0000)';
          })
        : undefined,
    })));

    const changes: Partial<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }> = {};

    if (answers.name !== existing.name) changes.name = answers.name;
    if (answers.category !== existing.category) changes.category = answers.category;
    if (answers.color !== (existing.color || '')) changes.color = answers.color || undefined;
    if (answers.description !== (existing.description || '')) changes.description = answers.description || undefined;
    if (answers.isDefault !== (existing.isDefault || false)) changes.isDefault = answers.isDefault;

    return changes;
  }
}
