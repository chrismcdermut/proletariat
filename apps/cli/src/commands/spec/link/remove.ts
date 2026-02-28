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

export default class SpecLinkRemove extends PMOCommand {
  static description = 'Remove a dependency between specs';

  static examples = [
    '<%= config.bin %> <%= command.id %> SPEC-001 SPEC-002',
    '<%= config.bin %> <%= command.id %> SPEC-001 --machine',
  ];

  static args = {
    spec: Args.string({
      description: 'Source spec ID',
      required: true,
    }),
    target: Args.string({
      description: 'Target spec ID to remove dependency from',
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
    const { args, flags } = await this.parse(SpecLinkRemove);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec link remove', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify source spec exists
    const sourceSpec = await this.storage.getSpec(args.spec);
    if (!sourceSpec) {
      return handleError('SPEC_NOT_FOUND', `Spec not found: ${args.spec}`);
    }

    // If target not provided, show existing dependencies for selection
    if (!args.target) {
      const dependencies = await this.storage.listSpecDependencies(args.spec);
      if (dependencies.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_DEPENDENCIES', `No dependencies found for ${args.spec}.`, createMetadata('spec link remove', flags));
          return;
        }
        this.log(styles.muted(`No dependencies found for ${args.spec}.`));
        return;
      }

      // Get spec details for dependency targets
      const choices: Array<{ name: string; value: string; command: string }> = [];
      for (const dep of dependencies) {
        // eslint-disable-next-line no-await-in-loop
        const targetSpec = await this.storage.getSpec(dep.dependsOnSpecId);
        const name = targetSpec ? `${dep.dependsOnSpecId} - ${targetSpec.title} (${dep.dependencyType})` : `${dep.dependsOnSpecId} (${dep.dependencyType})`;
        choices.push({
          name,
          value: dep.dependsOnSpecId,
          command: `prlt spec link remove ${args.spec} ${dep.dependsOnSpecId} --json`,
        });
      }

      const message = `Select dependency to remove from ${args.spec}:`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'target', message, choices),
          createMetadata('spec link remove', flags)
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

    // Remove the dependency
    try {
      await this.storage.deleteSpecDependency(args.spec, args.target!);

      this.log(styles.success(`\nRemoved dependency: ${args.spec} no longer depends on ${args.target}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return handleError('NOT_FOUND', `Dependency not found between ${args.spec} and ${args.target}`);
      }
      throw error;
    }
  }
}
