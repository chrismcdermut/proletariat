import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class PhaseTemplateApply extends PMOCommand {
  static description = 'Apply a phase template to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> default',
    '<%= config.bin %> <%= command.id %> agile',
    '<%= config.bin %> <%= command.id %> product --force  # Skip confirmation',
  ];

  static args = {
    template: Args.string({
      description: 'Phase template ID to apply',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing phases)',
      default: false,
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
    const { args, flags } = await this.parse(PhaseTemplateApply);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase template apply', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify template exists
    const template = await this.storage.getPhaseTemplate(args.template);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Phase template not found: ${args.template}. Run 'prlt phase template list' to see available templates.`);
    }

    // Check if workspace has existing phases
    const existingPhases = await this.storage.listPhases();
    if (existingPhases.length > 0 && !flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Workspace has ${existingPhases.length} existing phase(s). Applying will REPLACE all. Apply template "${template.name}"?`, confirmChoices),
          createMetadata('phase template apply', flags)
        );
        return;
      }

      this.log(styles.warning(`\nWorkspace has ${existingPhases.length} existing phase(s).`));
      this.log(styles.warning('Applying a template will REPLACE all existing phases.'));
      this.log('');

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Apply template "${template.name}" and replace existing phases?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Apply template
    const phases = await this.storage.applyPhaseTemplate(args.template);

    this.log(styles.success(`\nApplied phase template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`Created ${phases.length} phases:`));
    for (const phase of phases) {
      const defaultBadge = phase.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
    }
  }
}
