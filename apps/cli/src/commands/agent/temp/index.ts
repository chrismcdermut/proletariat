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

export default class Temp extends PMOCommand {
  static description = 'Manage temporary (ephemeral) agents';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> cleanup --temp',
    '<%= config.bin %> <%= command.id %> cleanup bold-bezos-1',
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
    const { flags } = await this.parse(Temp);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List temp agents', value: 'list' },
      { name: 'Clean up temp agents', value: 'cleanup' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('agent temp', flags)
      );
      return;
    }

    this.log(colors.primary('Temporary Agents'));
    this.log(colors.textMuted('Ephemeral agents created by "prlt work spawn".\n'));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
        { name: '🧹 ' + menuChoices[1].name, value: menuChoices[1].value },
        new inquirer.Separator(),
        { name: '❌ ' + menuChoices[2].name, value: menuChoices[2].value },
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
        case 'cleanup': {
          const { default: CleanupCommand } = await import('./cleanup.js');
          const cmd = new CleanupCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute temp ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
