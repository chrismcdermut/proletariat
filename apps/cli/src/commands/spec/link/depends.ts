import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class SpecLinkDepends extends PMOCommand {
  static description = 'Add a dependency between specs';

  static examples = [
    '<%= config.bin %> <%= command.id %> SPEC-001 SPEC-002',
    '<%= config.bin %> <%= command.id %> SPEC-001 --machine',
  ];

  static args = {
    spec: Args.string({
      description: 'Source spec ID (the one that depends on another)',
      required: true,
    }),
    target: Args.string({
      description: 'Target spec ID (the one depended upon)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecLinkDepends);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec link depends', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify source spec exists
    const sourceSpec = await this.storage.getSpec(args.spec);
    if (!sourceSpec) {
      return handleError('SPEC_NOT_FOUND', `Spec not found: ${args.spec}`);
    }

    // If target not provided, prompt for selection
    if (!args.target) {
      const specs = await this.storage.listSpecs();
      const otherSpecs = specs.filter(s => s.id !== args.spec);

      if (otherSpecs.length === 0) {
        return handleError('NO_SPECS', 'No other specs to select as dependency.');
      }

      const choices = otherSpecs.map(s => ({
        name: `${s.id} - ${s.title}`,
        value: s.id,
        command: `prlt spec link depends ${args.spec} ${s.id} --json`,
      }));
      const message = `Select spec that ${args.spec} depends on:`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'target', message, choices),
          createMetadata('spec link depends', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.target = selected;
    }

    // Verify target spec exists
    const targetSpec = await this.storage.getSpec(args.target!);
    if (!targetSpec) {
      return handleError('TARGET_NOT_FOUND', `Spec not found: ${args.target}`);
    }

    // Create the dependency
    try {
      await this.storage.createSpecDependency(args.spec, args.target!, 'depends_on');

      this.log(styles.success(`\n${args.spec} now depends on ${args.target}`));
      this.log(styles.muted(`  ${sourceSpec.title}`));
      this.log(styles.muted(`  depends on: ${targetSpec.title}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return handleError('ALREADY_EXISTS', 'Dependency already exists.');
      }
      throw error;
    }
  }
}
