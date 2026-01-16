import { Args, Flags } from '@oclif/core';
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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
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

      // In JSON mode, output phase selection prompt
      if (jsonMode) {
        const phaseChoices = phases.map(p => ({
          name: `${p.name} (${p.category}, position ${p.position})`,
          value: p.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'phaseId', 'Select phase to move:', phaseChoices),
          createMetadata('phase move', flags)
        );
        return;
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
      return handleError('PHASE_NOT_FOUND', `Phase "${phaseId}" not found.`);
    }

    // Get position - prompt if not provided
    let newPosition = flags.position;

    if (newPosition === undefined) {
      // Get phases in the same category to show valid positions
      const phases = await this.storage.listPhases();
      const categoryPhases = phases.filter(p => p.category === phase.category);

      // In JSON mode, output position selection prompt
      if (jsonMode) {
        const positionChoices = categoryPhases.map((_, idx) => ({
          name: `Position ${idx}${idx === phase.position ? ' (current)' : ''}`,
          value: String(idx),
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'position', `New position within ${phase.category} (currently ${phase.position}):`, positionChoices),
          createMetadata('phase move', flags)
        );
        return;
      }

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
