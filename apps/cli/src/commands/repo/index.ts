import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Repo extends PMOCommand {
  static description = 'Repository management operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add /path/to/repo',
    '<%= config.bin %> <%= command.id %> remove my-repo',
    '<%= config.bin %> <%= command.id %> view my-repo',
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
    const { flags } = await this.parse(Repo);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List all repositories', value: 'list' },
      { name: 'Add repository', value: 'add' },
      { name: 'Remove repository', value: 'remove' },
      { name: 'View repository details', value: 'view' },
      { name: 'Add multiple repositories', value: 'add-bulk' },
      { name: 'Remove multiple repositories', value: 'remove-bulk' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('repo', flags)
      );
      return;
    }

    this.log(colors.primary('📦 Repository Operations'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
        new inquirer.Separator('─── Single Repository ───'),
        { name: '➕ ' + menuChoices[1].name, value: menuChoices[1].value },
        { name: '🗑️  ' + menuChoices[2].name, value: menuChoices[2].value },
        { name: '📄 ' + menuChoices[3].name, value: menuChoices[3].value },
        new inquirer.Separator('─── Bulk Operations ───'),
        { name: '📦 ' + menuChoices[4].name, value: menuChoices[4].value },
        { name: '🗑️  ' + menuChoices[5].name, value: menuChoices[5].value },
        new inquirer.Separator(),
        { name: '❌ ' + menuChoices[6].name, value: menuChoices[6].value }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      this.log(colors.primary(`\nExecuting: repo ${action}`));

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
        case 'add-bulk': {
          const { default: AddCommand } = await import('./add.js');
          const cmd = new AddCommand(['--bulk'], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove-bulk': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand(['--bulk'], this.config);
          await cmd.run();
          break;
        }
        case 'view': {
          const { default: ViewCommand } = await import('./view.js');
          const cmd = new ViewCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute repo ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
