import { Flags, Args } from '@oclif/core';
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

export default class StatusMove extends PMOCommand {
  static description = 'Reorder a status within its category';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-in-review --position 0  # Move to first',
    '<%= config.bin %> <%= command.id %> my-project-blocked --position 2',
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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed) within the category',
      required: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusMove);
    // This command requires project context
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status move', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get status ID - prompt if not provided
    let statusId = args.id;

    if (!statusId) {
      const statuses = await this.storage.listStatuses(projectId);
      if (statuses.length === 0) {
        return handleError('NO_STATUSES', 'No statuses found. Create a status first with "prlt status create".');
      }

      // In JSON mode, output status selection prompt
      if (jsonMode) {
        const statusChoices = statuses.map(s => ({
          name: `${s.name} (${s.category}, position ${s.position})`,
          value: s.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select status to move:', statusChoices),
          createMetadata('status move', flags)
        );
        return;
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select status to move:',
        choices: statuses.map(s => ({
          name: `${s.name} (${s.category}, position ${s.position})`,
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

    // Get position - prompt if not provided
    let newPosition = flags.position;

    if (newPosition === undefined) {
      // Get statuses in the same category to show valid positions
      const statuses = await this.storage.listStatuses(projectId);
      const categoryStatuses = statuses.filter(s => s.category === existing.category);

      // In JSON mode, output position selection prompt
      if (jsonMode) {
        const positionChoices = categoryStatuses.map((_, idx) => ({
          name: `Position ${idx}${idx === existing.position ? ' (current)' : ''}`,
          value: String(idx),
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'position', `New position within ${existing.category} (currently ${existing.position}):`, positionChoices),
          createMetadata('status move', flags)
        );
        return;
      }

      const { position } = await inquirer.prompt([{
        type: 'list',
        name: 'position',
        message: `New position within ${existing.category} (currently ${existing.position}):`,
        choices: categoryStatuses.map((_, idx) => ({
          name: `Position ${idx}${idx === existing.position ? ' (current)' : ''}`,
          value: idx,
        })),
        default: existing.position,
      }]);
      newPosition = position;
    }

    if (newPosition! < 0) {
      this.error('Position must be >= 0');
    }

    const updated = await this.storage.reorderStatus(statusId!, newPosition!);

    if (existing.position === updated.position) {
      this.log(styles.muted(`Status "${updated.name}" is already at position ${updated.position}`));
    } else {
      this.log(styles.success(`Moved "${updated.name}" from position ${existing.position} to ${updated.position}`));
    }
  }
}
