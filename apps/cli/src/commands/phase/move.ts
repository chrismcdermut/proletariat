import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

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

      const idResolver = new FlagResolver<{ phaseId?: string; json?: boolean; machine?: boolean }>({
        commandName: 'phase move',
        baseCommand: 'prlt phase move',
        jsonMode,
        flags: { json: flags.json, machine: flags.machine },
      });

      idResolver.addPrompt({
        flagName: 'phaseId',
        type: 'list',
        message: 'Select phase to move:',
        choices: () => phases.map(p => ({
          name: `${p.name} (${p.category}, position ${p.position})`,
          value: p.id,
        })),
        // Use positional arg format for phase ID
        getCommand: (value) => `prlt phase move ${value} --json`,
      });

      const resolved = await idResolver.resolve();
      if (!resolved.phaseId) {
        return; // Cancelled
      }
      phaseId = resolved.phaseId;
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

      const posResolver = new FlagResolver<{ position?: string; json?: boolean; machine?: boolean }>({
        commandName: 'phase move',
        baseCommand: `prlt phase move ${phaseId}`,
        jsonMode,
        flags: { json: flags.json, machine: flags.machine },
      });

      posResolver.addPrompt({
        flagName: 'position',
        type: 'list',
        message: `New position within ${phase.category} (currently ${phase.position}):`,
        choices: () => categoryPhases.map((_, idx) => ({
          name: `Position ${idx}${idx === phase.position ? ' (current)' : ''}`,
          value: String(idx),
        })),
        default: String(phase.position),
      });

      const resolved = await posResolver.resolve();
      if (!resolved.position) {
        return; // Cancelled
      }
      newPosition = parseInt(resolved.position, 10);
    }

    // Get phases in same category for validation
    const allPhases = await this.storage.listPhases();
    const categoryPhases = allPhases.filter(p => p.category === phase.category);
    const maxPosition = categoryPhases.length - 1;

    if (newPosition! < 0) {
      this.error('Position must be >= 0');
    }

    if (newPosition! > maxPosition) {
      this.warn(`Position ${newPosition} exceeds max (${maxPosition}). Clamping to ${maxPosition}.`);
      newPosition = maxPosition;
    }

    const updated = await this.storage.reorderPhase(phaseId!, newPosition!);

    if (phase.position === updated.position) {
      this.log(styles.muted(`Phase "${updated.name}" is already at position ${updated.position}`));
    } else {
      this.log(styles.success(`\nMoved phase "${updated.name}" from position ${phase.position} to ${updated.position}`));
    }
  }
}
