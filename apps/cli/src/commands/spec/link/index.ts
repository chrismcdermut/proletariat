import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class SpecLink extends PMOCommand {
  static description = 'Manage links (dependencies) for a spec';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> SPEC-001',
    '<%= config.bin %> <%= command.id %> --machine',
  ];

  static args = {
    spec: Args.string({
      description: 'Spec ID',
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
    const { args, flags } = await this.parse(SpecLink);
    const jsonMode = shouldOutputJson(flags);

    // If no spec ID provided, prompt for selection
    if (!args.spec) {
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        this.log(styles.muted('No specs found.'));
        return;
      }

      const choices = specs.map(s => ({
        name: `${s.id} - ${s.title}`,
        value: s.id,
        command: `prlt spec link ${s.id} --machine`,
      }));
      const message = 'Select a spec to manage links:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'id', message, choices),
          createMetadata('spec link', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.spec = selected;
    }

    const spec = await this.storage.getSpec(args.spec!);
    if (!spec) {
      this.error(`Spec not found: ${args.spec}`);
    }

    // Show link actions submenu
    const menuChoices = [
      { name: 'Add dependency', value: 'depends', command: `prlt spec link depends ${args.spec} --machine` },
      { name: 'Remove dependency', value: 'remove', command: `prlt spec link remove ${args.spec} --machine` },
      { name: 'Cancel', value: 'cancel', command: '' },
    ];
    const message = `Manage links for ${args.spec}: ${spec.title}`;

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('spec link', flags)
      );
      return;
    }

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices,
    }], null);

    if (action === 'cancel') {
      this.log(styles.muted('Cancelled.'));
      return;
    }

    switch (action) {
      case 'depends': {
        const { default: DependsCommand } = await import('./depends.js');
        const cmd = new DependsCommand([args.spec!], this.config);
        await cmd.run();
        break;
      }
      case 'remove': {
        const { default: RemoveCommand } = await import('./remove.js');
        const cmd = new RemoveCommand([args.spec!], this.config);
        await cmd.run();
        break;
      }
    }
  }
}
