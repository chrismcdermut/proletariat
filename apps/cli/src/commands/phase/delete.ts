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

export default class PhaseDelete extends PMOCommand {
  static description = 'Delete a project lifecycle phase';

  static examples = [
    '<%= config.bin %> <%= command.id %> on-hold',
    '<%= config.bin %> <%= command.id %> on-hold --force',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
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
    const { args, flags } = await this.parse(PhaseDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const phase = await this.storage.getPhase(args.id);
    if (!phase) {
      return handleError('PHASE_NOT_FOUND', `Phase "${args.id}" not found.`);
    }

    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Delete phase "${phase.name}"?`, confirmChoices),
          createMetadata('phase delete', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete phase "${phase.name}"?`,
        default: false,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deletePhase(args.id);

    this.log(styles.success(`\nDeleted phase "${phase.name}"`));
  }
}
