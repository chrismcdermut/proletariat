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

export default class SpecPlan extends PMOCommand {
  static description = 'Generate tickets from spec by comparing ideal state vs codebase (uses LLM)';

  static examples = [
    '<%= config.bin %> <%= command.id %> user-authentication',
    '<%= config.bin %> <%= command.id %> --spec api-design --dry-run',
  ];

  static args = {
    spec: Args.string({
      description: 'Spec ID',
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
    spec: Flags.string({
      char: 's',
      description: 'Spec ID',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be created without creating tickets',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecPlan);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec plan', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get spec ID
    let specId = args.spec || flags.spec;

    if (!specId) {
      // List specs and prompt for selection
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        return handleError('NO_SPECS', 'No specs found. Create a spec first with "prlt spec create".');
      }

      // In JSON mode, output spec selection prompt
      if (jsonMode) {
        const specChoices = specs.map(s => ({
          name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
          value: s.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'spec', 'Select spec to plan:', specChoices),
          createMetadata('spec plan', flags)
        );
        return;
      }

      const { selectedSpec } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedSpec',
          message: 'Select spec to plan:',
          choices: specs.map(s => ({
            name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
            value: s.id,
          })),
        },
      ]);
      specId = selectedSpec;
    }

    // Get the spec
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    this.log(styles.header(`\n📋 Planning from spec: ${spec.title}`));
    this.log('');

    // TODO: Call LLM to compare spec vs codebase and generate tickets
    // For now, just show the spec content

    this.log(styles.muted('Spec content:'));
    if (spec.problem) {
      this.log(styles.muted(`\nProblem:`));
      this.log(`  ${spec.problem}`);
    }
    if (spec.solution) {
      this.log(styles.muted(`\nSolution:`));
      this.log(`  ${spec.solution}`);
    }
    if (spec.acceptanceCriteria) {
      this.log(styles.muted(`\nAcceptance Criteria:`));
      this.log(`  ${spec.acceptanceCriteria}`);
    }

    this.log('');
    this.log(styles.warning('LLM-based ticket generation not yet implemented.'));
    this.log(styles.muted('This command will:'));
    this.log(styles.muted('  1. Read the spec (ideal state)'));
    this.log(styles.muted('  2. Analyze the codebase (current state)'));
    this.log(styles.muted('  3. Generate tickets for the delta'));
    this.log('');

    if (flags['dry-run']) {
      this.log(styles.muted('(dry-run mode - no tickets would be created)'));
    }
  }
}
