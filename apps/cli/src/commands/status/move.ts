import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

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

    // Get status ID - prompt if not provided
    let statusId = args.id;

    if (!statusId) {
      const statuses = await this.storage.listStatuses(this.projectId);
      if (statuses.length === 0) {
        this.error('No statuses found. Create a status first with "prlt status create".');
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
      this.error(`Status not found: ${statusId}`);
    }

    // Get position - prompt if not provided
    let newPosition = flags.position;

    if (newPosition === undefined) {
      // Get statuses in the same category to show valid positions
      const statuses = await this.storage.listStatuses(this.projectId);
      const categoryStatuses = statuses.filter(s => s.category === existing.category);

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
