import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { WorkflowRuleTrigger } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class WorkflowRuleUpdate extends PMOCommand {
  static description = 'Update a workflow rule';

  static examples = [
    '<%= config.bin %> <%= command.id %> todo-implement --trigger on_enter',
    '<%= config.bin %> <%= command.id %> todo-implement --no-enabled',
    '<%= config.bin %> <%= command.id %> todo-implement --action-id continue',
  ];

  static args = {
    id: Args.string({
      description: 'Rule ID to update',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    'from-state': Flags.string({
      description: 'New source state (empty string = any state)',
    }),
    'to-state': Flags.string({
      description: 'New target state',
    }),
    'action-id': Flags.string({
      description: 'New action ID',
    }),
    trigger: Flags.string({
      description: 'New trigger type',
      options: ['manual', 'on_enter'],
    }),
    enabled: Flags.boolean({
      description: 'Enable or disable the rule',
      allowNo: true,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowRuleUpdate);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workflow-rule update', flags));
        return
      }
      this.error(message);
    };

    const existing = await this.storage.getWorkflowRule(args.id);
    if (!existing) {
      return handleError('RULE_NOT_FOUND', `Workflow rule not found: ${args.id}`);
    }

    const changes: Partial<{
      fromState: string | undefined;
      toState: string;
      actionId: string;
      trigger: WorkflowRuleTrigger;
      enabled: boolean;
    }> = {};

    if (flags['from-state'] !== undefined) {
      changes.fromState = flags['from-state'] || undefined;
    }
    if (flags['to-state']) {
      changes.toState = flags['to-state'];
    }
    if (flags['action-id']) {
      changes.actionId = flags['action-id'];
    }
    if (flags.trigger) {
      changes.trigger = flags.trigger as WorkflowRuleTrigger;
    }
    if (flags.enabled !== undefined) {
      changes.enabled = flags.enabled;
    }

    if (Object.keys(changes).length === 0) {
      this.log(styles.muted('No changes specified. Use flags to specify changes.'));
      return;
    }

    const rule = await this.storage.updateWorkflowRule(args.id, changes);

    this.log(styles.success(`\nUpdated workflow rule "${styles.emphasis(rule.id)}"`));
    this.log(`  ${styles.muted('From:')} ${rule.fromState || '(any)'} ${styles.muted('→')} ${styles.muted('To:')} ${rule.toState}`);
    this.log(`  ${styles.muted('Action:')} ${rule.actionId}`);
    this.log(`  ${styles.muted('Trigger:')} ${rule.trigger}`);
    this.log(`  ${styles.muted('Enabled:')} ${rule.enabled ? 'Yes' : 'No'}`);
    this.log('');
  }
}
