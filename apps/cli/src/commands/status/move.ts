import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
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
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed) within the category',
      required: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusMove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // This command requires project context - get projectId (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'status move',
        baseCommand: 'prlt status move',
      } : undefined,
    });

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status move', flags));
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

      // Use helper for status selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select status to move:',
        items: statuses,
        getName: (s) => `${s.name} (${s.category}, position ${s.position})`,
        getValue: (s) => s.id,
        getCommand: (s) => `prlt status move ${s.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'status move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      statusId = selected;
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
      const statuses = await this.storage.listStatuses(project.workflowId);
      const categoryStatuses = statuses.filter(s => s.category === existing.category);

      // Use helper for position selection (handles JSON mode automatically)
      const positionItems = categoryStatuses.map((_, idx) => ({
        position: idx,
        label: `Position ${idx}${idx === existing.position ? ' (current)' : ''}`,
      }));

      const selected = await this.selectFromList({
        message: `New position within ${existing.category} (currently ${existing.position}):`,
        items: positionItems,
        getName: (p) => p.label,
        getValue: (p) => String(p.position),
        getCommand: (p) => `prlt status move ${statusId} --position ${p.position} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'status move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      newPosition = parseInt(selected, 10);
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
