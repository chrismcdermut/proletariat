import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import {
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

interface MoveFlags {
  id?: string;
  position?: number;
  project?: string;
  json?: boolean;
  machine?: boolean;
  [key: string]: unknown;
}

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
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status move', flags));
        return
      }
      this.error(message);
    };

    // Get the project's workflow ID
    const project = await this.storage.getProject(projectId);
    if (!project?.workflowId) {
      return handleError('NO_WORKFLOW', `Project "${projectId}" has no workflow assigned.`);
    }

    // Get all statuses for this workflow
    const statuses = await this.storage.listStatuses(project.workflowId);
    if (statuses.length === 0) {
      return handleError('NO_STATUSES', 'No statuses found. Create a status first with "prlt status create".');
    }

    // Create FlagResolver for prompts
    const resolver = new FlagResolver<MoveFlags>({
      commandName: 'status move',
      baseCommand: 'prlt status move',
      jsonMode,
      flags: { ...flags, id: args.id },
      context: { projectId },
    });

    // Add status selection prompt
    resolver.addPrompt({
      flagName: 'id',
      type: 'list',
      message: 'Select status to move:',
      choices: () => statuses.map(s => ({
        name: `${s.name} (${s.category}, position ${s.position})`,
        value: s.id,
        command: `prlt status move ${s.id} --machine`,
      })),
      when: (ctx) => !ctx.flags.id,
    });

    // Resolve status ID
    const resolved = await resolver.resolve();
    const statusId = resolved.id;

    // Get existing status
    const existing = await this.storage.getStatus(statusId!);
    if (!existing) {
      return handleError('STATUS_NOT_FOUND', `Status not found: ${statusId}`);
    }

    // Get statuses in the same category for position selection
    const categoryStatuses = statuses.filter(s => s.category === existing.category);

    // Create second resolver for position (needs status context)
    const positionResolver = new FlagResolver<MoveFlags>({
      commandName: 'status move',
      baseCommand: 'prlt status move',
      jsonMode,
      flags: { ...flags, id: statusId },
      context: { projectId, statusId, existing },
    });

    // Add position selection prompt
    positionResolver.addPrompt({
      flagName: 'position',
      type: 'list',
      message: `New position within ${existing.category} (currently ${existing.position}):`,
      choices: () => categoryStatuses.map((_, idx) => ({
        name: `Position ${idx}${idx === existing.position ? ' (current)' : ''}`,
        value: idx,
        command: `prlt status move ${statusId} --position ${idx} --machine`,
      })),
      when: (ctx) => ctx.flags.position === undefined,
    });

    // Resolve position
    const positionResolved = await positionResolver.resolve();
    const newPosition = positionResolved.position;

    if (newPosition! < 0) {
      if (jsonMode) {
        outputErrorAsJson('INVALID_POSITION', 'Position must be >= 0', createMetadata('status move', flags));
        return
      }
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
