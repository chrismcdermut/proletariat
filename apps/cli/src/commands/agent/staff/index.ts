import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../../lib/colors.js';
import { PromptCommand } from '../../../lib/prompt-command.js'
import { machineOutputFlags } from '../../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class AgentStaff extends PromptCommand {
  static description = 'Manage staff (persistent) agents';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove camry',
  ];

  static flags = {
    ...machineOutputFlags,
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AgentStaff);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List staff agents', value: 'list', command: 'prlt agent staff list --machine' },
      { name: 'Add staff agent', value: 'add', command: 'prlt agent staff add --machine' },
      { name: 'Remove staff agent', value: 'remove', command: 'prlt agent staff remove --machine' },
      { name: 'Cancel', value: 'cancel', command: '' },
    ];
    const message = 'What would you like to do?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('agent staff', flags)
      );
      return;
    }

    this.log(colors.primary('Staff Agents'));
    this.log(colors.textMuted('Persistent agents with dedicated worktrees.\n'));

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
        { name: '➕ ' + menuChoices[1].name, value: menuChoices[1].value },
        { name: '🗑️  ' + menuChoices[2].name, value: menuChoices[2].value },
        new inquirer.Separator(),
        { name: '❌ ' + menuChoices[3].name, value: menuChoices[3].value },
      ]
    }], null);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'add': {
          const { default: AddCommand } = await import('./add.js');
          const cmd = new AddCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute staff ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
