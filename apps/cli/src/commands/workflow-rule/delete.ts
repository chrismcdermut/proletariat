import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class WorkflowRuleDelete extends PMOCommand {
  static description = 'Delete a workflow rule';

  static examples = [
    '<%= config.bin %> <%= command.id %> todo-implement',
    '<%= config.bin %> <%= command.id %> todo-implement --force',
  ];

  static args = {
    id: Args.string({
      description: 'Rule ID to delete',
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
    const { args, flags } = await this.parse(WorkflowRuleDelete);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workflow-rule delete', flags));
        return
      }
      this.error(message);
    };

    const rule = await this.storage.getWorkflowRule(args.id);

    if (!rule) {
      return handleError('RULE_NOT_FOUND', `Workflow rule not found: ${args.id}`);
    }

    if (!flags.force) {
      const resolver = new FlagResolver<{ confirmed?: boolean }>({
        commandName: 'workflow-rule delete',
        baseCommand: `prlt workflow-rule delete ${args.id}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'confirmed',
        type: 'list',
        message: `Delete workflow rule "${rule.id}" (${rule.fromState || 'any'} → ${rule.toState} → ${rule.actionId})?`,
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        getCommand: (value) => value
          ? `prlt workflow-rule delete ${args.id} --force --json`
          : '',
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirmed) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deleteWorkflowRule(args.id);

    this.log(styles.success(`\nDeleted workflow rule "${rule.id}"`));
  }
}
