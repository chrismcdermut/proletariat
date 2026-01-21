import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class Staff extends PMOCommand {
  static description = 'Manage staff (persistent) agents';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove camry',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Staff);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List staff agents', value: 'list' },
      { name: 'Add staff agent', value: 'add' },
      { name: 'Remove staff agent', value: 'remove' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('agent staff', flags)
      );
      return;
    }

    this.log(colors.primary('Staff Agents'));
    this.log(colors.textMuted('Persistent agents with dedicated worktrees.\n'));

    const { action } = await inquirer.prompt([{
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
    }]);

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
