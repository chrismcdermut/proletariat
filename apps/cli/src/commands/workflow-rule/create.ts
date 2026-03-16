import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { WorkflowRuleTrigger } from '../../lib/pmo/types.js';
import { shouldOutputJson, outputErrorAsJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class WorkflowRuleCreate extends PMOCommand {
  static description = 'Create a new workflow rule';

  static examples = [
    '<%= config.bin %> <%= command.id %> --to-state "In Progress" --action-id implement --trigger on_enter',
    '<%= config.bin %> <%= command.id %> --from-state "Backlog" --to-state "Todo" --action-id groom',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static flags = {
    ...pmoBaseFlags,
    'from-state': Flags.string({
      description: 'Source state (empty = any source state)',
    }),
    'to-state': Flags.string({
      description: 'Target state that triggers the rule [required]',
    }),
    'action-id': Flags.string({
      description: 'Action to fire when rule matches [required]',
    }),
    trigger: Flags.string({
      description: 'Trigger type',
      options: ['manual', 'on_enter'],
      default: 'manual',
    }),
    enabled: Flags.boolean({
      description: 'Whether the rule is enabled',
      default: true,
      allowNo: true,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkflowRuleCreate);

    const jsonMode = shouldOutputJson(flags);

    let toState = flags['to-state'];
    let actionId = flags['action-id'];
    let fromState: string | undefined = flags['from-state'];
    let trigger: WorkflowRuleTrigger = (flags.trigger as WorkflowRuleTrigger) || 'manual';

    // Interactive mode if required fields are missing
    if (!toState || !actionId) {
      // Get available actions for choices
      const actions = await this.storage.listActions();
      const actionChoices = actions.map(a => ({
        name: `${a.name} (${a.id})`,
        value: a.id,
      }));

      const triggerChoices = [
        { name: 'manual — suggested but not auto-fired', value: 'manual' },
        { name: 'on_enter — auto-fires when ticket enters state', value: 'on_enter' },
      ];

      const resolver = new FlagResolver<{
        toState?: string;
        actionId?: string;
        fromState?: string;
        trigger?: string;
      }>({
        commandName: 'workflow-rule create',
        baseCommand: 'prlt workflow-rule create',
        jsonMode,
        flags: {
          toState,
          actionId,
          fromState,
          trigger,
        },
      });

      resolver.addPrompt({
        flagName: 'toState',
        type: 'input',
        message: 'Target state (triggers when ticket enters this state):',
        when: (ctx) => !ctx.flags.toState,
        validate: (value) => (value as string).trim() ? true : 'Target state is required',
        context: {
          hint: 'Provide with: prlt workflow-rule create --to-state "State" --action-id "action"',
          requiredFields: ['--to-state', '--action-id'],
        },
      });

      resolver.addPrompt({
        flagName: 'actionId',
        type: 'list',
        message: 'Action to fire:',
        choices: () => actionChoices,
        when: (ctx) => !ctx.flags.actionId && ctx.flags.toState !== undefined,
        context: (ctx) => ({
          hint: `Provide with: prlt workflow-rule create --to-state "${ctx.flags.toState}" --action-id "action-id"`,
          requiredFields: ['--action-id'],
          optionalFields: ['--from-state', '--trigger'],
        }),
      });

      resolver.addPrompt({
        flagName: 'fromState',
        type: 'input',
        message: 'Source state (empty = any source state):',
        default: fromState || '',
        when: (ctx) => ctx.flags.toState !== undefined && ctx.flags.actionId !== undefined,
      });

      resolver.addPrompt({
        flagName: 'trigger',
        type: 'list',
        message: 'Trigger type:',
        choices: () => triggerChoices,
        default: trigger,
        when: (ctx) => ctx.flags.toState !== undefined && ctx.flags.actionId !== undefined,
      });

      const resolved = await resolver.resolve();

      toState = resolved.toState || toState;
      actionId = resolved.actionId || actionId;
      fromState = resolved.fromState || fromState;
      trigger = (resolved.trigger || trigger) as WorkflowRuleTrigger;
    }

    if (!toState || !actionId) {
      if (jsonMode) {
        outputErrorAsJson('MISSING_REQUIRED', 'to-state and action-id are required.', createMetadata('workflow-rule create', flags));
      }
      this.error('to-state and action-id are required.');
    }

    const rule = await this.storage.createWorkflowRule({
      fromState: fromState || undefined,
      toState,
      actionId,
      trigger,
      enabled: flags.enabled,
    });

    if (jsonMode) {
      outputSuccessAsJson({
        ...rule,
        message: `Created workflow rule "${rule.id}"`,
      }, createMetadata('workflow-rule create', flags));
      return;
    }

    this.log(styles.success(`\nCreated workflow rule "${styles.emphasis(rule.id)}"`));
    this.log(`  ${styles.muted('From:')} ${rule.fromState || '(any)'} ${styles.muted('→')} ${styles.muted('To:')} ${rule.toState}`);
    this.log(`  ${styles.muted('Action:')} ${rule.actionId}`);
    this.log(`  ${styles.muted('Trigger:')} ${rule.trigger}`);
    this.log(`  ${styles.muted('Enabled:')} ${rule.enabled ? 'Yes' : 'No'}`);
    this.log('');
  }
}
