import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class PhaseMove extends PMOCommand {
  static description = 'Change the position of a phase within its category';

  static examples = [
    '<%= config.bin %> <%= command.id %> on-hold --position 0',
    '<%= config.bin %> <%= command.id %> in-review --position 1',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed)',
      required: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseMove);

    // Get phase ID - prompt if not provided
    let phaseId = args.id;

    if (!phaseId) {
      const phases = await this.storage.listPhases();
      if (phases.length === 0) {
        this.error('No phases found. Create a phase first with "prlt phase create".');
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select phase to move:',
        choices: phases.map(p => ({
          name: `${p.name} (${p.category}, position ${p.position})`,
          value: p.id,
        })),
      }]);
      phaseId = selectedId;
    }

    const phase = await this.storage.getPhase(phaseId!);
    if (!phase) {
      this.error(`Phase "${phaseId}" not found.`);
    }

    // Get position - prompt if not provided
    let newPosition = flags.position;

    if (newPosition === undefined) {
      // Get phases in the same category to show valid positions
      const phases = await this.storage.listPhases();
      const categoryPhases = phases.filter(p => p.category === phase.category);

      const { position } = await inquirer.prompt([{
        type: 'list',
        name: 'position',
        message: `New position within ${phase.category} (currently ${phase.position}):`,
        choices: categoryPhases.map((_, idx) => ({
          name: `Position ${idx}${idx === phase.position ? ' (current)' : ''}`,
          value: idx,
        })),
        default: phase.position,
      }]);
      newPosition = position;
    }

    if (newPosition! < 0) {
      this.error('Position must be >= 0');
    }

    const updated = await this.storage.reorderPhase(phaseId!, newPosition!);

    if (phase.position === updated.position) {
      this.log(styles.muted(`Phase "${updated.name}" is already at position ${updated.position}`));
    } else {
      this.log(styles.success(`\nMoved phase "${updated.name}" from position ${phase.position} to ${updated.position}`));
    }
  }
}
