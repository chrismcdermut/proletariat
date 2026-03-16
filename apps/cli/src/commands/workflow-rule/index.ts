import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { WorkflowRule } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class WorkflowRuleIndex extends PMOCommand {
  static description = 'Interactive menu for workflow rule operations';

  static aliases = ['workflow-rules'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkflowRuleIndex);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { id: 'list', name: 'List all rules', command: 'prlt workflow-rule list --machine' },
      { id: 'create', name: 'Create a rule', command: 'prlt workflow-rule create --machine' },
      { id: 'update', name: 'Update a rule', command: 'prlt workflow-rule update --machine' },
      { id: 'delete', name: 'Delete a rule', command: 'prlt workflow-rule delete --machine' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Workflow Rules - What would you like to do?';

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'workflow-rule' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    switch (action) {
      case 'list':
        await this.config.runCommand('workflow-rule:list', []);
        break;
      case 'create':
        await this.config.runCommand('workflow-rule:create', []);
        break;
      case 'update': {
        const ruleId = await this.selectRule('Select rule to update:');
        if (ruleId) {
          await this.config.runCommand('workflow-rule:update', [ruleId]);
        }
        break;
      }
      case 'delete': {
        const ruleId = await this.selectRule('Select rule to delete:');
        if (ruleId) {
          await this.config.runCommand('workflow-rule:delete', [ruleId]);
        }
        break;
      }
    }
  }

  private async selectRule(message: string): Promise<string | null> {
    const rules = await this.storage.listWorkflowRules();

    if (rules.length === 0) {
      this.log('No workflow rules found.');
      return null;
    }

    const { selected } = await this.prompt<{ selected: string }>([{
      type: 'list',
      name: 'selected',
      message,
      choices: [
        ...rules.map(r => ({
          name: `${r.id} (${r.fromState || 'any'} → ${r.toState} → ${r.actionId})`,
          value: r.id,
        })),
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
    }], null);

    return selected;
  }
}
