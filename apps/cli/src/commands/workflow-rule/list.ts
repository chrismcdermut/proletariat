import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { WorkflowRule, WorkflowRuleFilter } from '../../lib/pmo/types.js';

export default class WorkflowRuleList extends PMOCommand {
  static description = 'List workflow rules';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --to-state "In Progress"',
    '<%= config.bin %> <%= command.id %> --trigger on_enter',
    '<%= config.bin %> <%= command.id %> --enabled',
  ];

  static flags = {
    ...pmoBaseFlags,
    'to-state': Flags.string({
      description: 'Filter by target state',
    }),
    'from-state': Flags.string({
      description: 'Filter by source state',
    }),
    'action-id': Flags.string({
      description: 'Filter by action ID',
    }),
    trigger: Flags.string({
      description: 'Filter by trigger type',
      options: ['manual', 'on_enter'],
    }),
    enabled: Flags.boolean({
      description: 'Show only enabled rules',
      allowNo: true,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkflowRuleList);

    const filter: WorkflowRuleFilter = {};
    if (flags['to-state']) filter.toState = flags['to-state'];
    if (flags['from-state']) filter.fromState = flags['from-state'];
    if (flags['action-id']) filter.actionId = flags['action-id'];
    if (flags.trigger) filter.trigger = flags.trigger as 'manual' | 'on_enter';
    if (flags.enabled !== undefined) filter.enabled = flags.enabled;

    const rules = await this.storage.listWorkflowRules(
      Object.keys(filter).length > 0 ? filter : undefined
    );

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(rules, null, 2));
      return;
    }

    if (rules.length === 0) {
      this.log(styles.muted('\nNo workflow rules found.'));
      this.log(styles.muted('Create one: prlt workflow-rule create'));
      return;
    }

    this.log(`\n${styles.emphasis('Workflow Rules')}`);
    this.log('═'.repeat(60));

    for (const rule of rules) {
      this.printRule(rule);
    }

    this.log('');
    this.log(styles.muted('Create rule: prlt workflow-rule create'));
    this.log('');
  }

  private printRule(rule: WorkflowRule): void {
    const status = rule.enabled ? styles.success('enabled') : styles.muted('disabled');
    this.log(`\n  ${styles.emphasis(rule.id)} [${status}]`);
    this.log(`    ${styles.muted('From:')} ${rule.fromState || '(any)'} ${styles.muted('→')} ${styles.muted('To:')} ${rule.toState}`);
    this.log(`    ${styles.muted('Action:')} ${rule.actionId} ${styles.muted('| Trigger:')} ${rule.trigger}`);
  }
}
