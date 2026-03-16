import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js';

export default class PhaseTemplateDelete extends PMOCommand {
  static description = 'Delete a phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to delete',
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
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateDelete);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase template delete', flags));
        return
      }
      this.error(message);
    };

    const template = await this.storage.getPhaseTemplate(args.id);
    if (!template) {
      return handleError('NOT_FOUND', `Phase template not found: ${args.id}`);
    }

    if (template.isBuiltin) {
      return handleError('BUILTIN', `Cannot delete built-in template "${template.name}".`);
    }

    if (!flags.force) {
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete phase template "${template.name}"?`,
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }], jsonMode ? { flags, commandName: 'phase template delete' } : null);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deletePhaseTemplate(args.id);
    this.log(styles.success(`\nDeleted phase template "${template.name}"`));
  }
}
