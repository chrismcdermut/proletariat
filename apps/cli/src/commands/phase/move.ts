import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseMove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase move', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get phase ID - prompt if not provided
    let phaseId = args.id;

    if (!phaseId) {
      const phases = await this.storage.listPhases();
      if (phases.length === 0) {
        return handleError('NO_PHASES', 'No phases found. Create a phase first with "prlt phase create".');
      }

      const selected = await this.selectFromList({
        message: 'Select phase to move:',
        items: phases,
        getName: (p) => `${p.name} (${p.category}, position ${p.position})`,
        getValue: (p) => p.id,
        getCommand: (p) => `prlt phase move ${p.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'phase move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      phaseId = selected;
    }

    const phase = await this.storage.getPhase(phaseId!);
    if (!phase) {
      return handleError('PHASE_NOT_FOUND', `Phase "${phaseId}" not found.`);
    }

    // Get position - prompt if not provided
    let newPosition = flags.position;

    if (newPosition === undefined) {
      // Get phases in the same category to show valid positions
      const phases = await this.storage.listPhases();
      const categoryPhases = phases.filter(p => p.category === phase.category);

      // Create position items for selectFromList
      const positionItems = categoryPhases.map((_, idx) => ({
        idx,
        label: `Position ${idx}${idx === phase.position ? ' (current)' : ''}`,
      }));

      const selected = await this.selectFromList({
        message: `New position within ${phase.category} (currently ${phase.position}):`,
        items: positionItems,
        getName: (p) => p.label,
        getValue: (p) => String(p.idx),
        getCommand: (p) => `prlt phase move ${phaseId} --position ${p.idx} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'phase move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      newPosition = parseInt(selected, 10);
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
