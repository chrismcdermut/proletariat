import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Agent extends PMOCommand {
  static description = 'Manage agents in the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> status camry',
    '<%= config.bin %> <%= command.id %> visit tacoma',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove camry',
    '<%= config.bin %> <%= command.id %> restart altman',
    '<%= config.bin %> <%= command.id %> rebuild altman',
    '<%= config.bin %> <%= command.id %> shell altman',
    '<%= config.bin %> <%= command.id %> themes list',
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
    const { flags } = await this.parse(Agent);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List all agents', value: 'list' },
      { name: 'Show status', value: 'status' },
      { name: 'Visit directory', value: 'visit' },
      { name: 'Add agent', value: 'add' },
      { name: 'Remove agent', value: 'remove' },
      { name: 'Manage themes', value: 'themes' },
      { name: 'Open shell', value: 'shell' },
      { name: 'Restart', value: 'restart' },
      { name: 'Rebuild', value: 'rebuild' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('agent', flags)
      );
      return;
    }

    this.log(colors.primary('🤖 Agent Management'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        new inquirer.Separator('── View ──'),
        { name: '📋 ' + menuChoices[0].name, value: menuChoices[0].value },
        { name: '📊 ' + menuChoices[1].name, value: menuChoices[1].value },
        { name: '📁 ' + menuChoices[2].name, value: menuChoices[2].value },
        new inquirer.Separator('── Manage ──'),
        { name: '➕ ' + menuChoices[3].name, value: menuChoices[3].value },
        { name: '🗑️  ' + menuChoices[4].name, value: menuChoices[4].value },
        { name: '🎨 ' + menuChoices[5].name, value: menuChoices[5].value },
        new inquirer.Separator('── Container ──'),
        { name: '🐚 ' + menuChoices[6].name, value: menuChoices[6].value },
        { name: '🔄 ' + menuChoices[7].name, value: menuChoices[7].value },
        { name: '🔨 ' + menuChoices[8].name, value: menuChoices[8].value },
        new inquirer.Separator(),
        { name: '❌ ' + menuChoices[9].name, value: menuChoices[9].value },
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    // Execute the selected command directly (no subprocess)
    try {
      this.log(colors.primary(`\nExecuting: agent ${action}`));

      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'status': {
          const { default: StatusCommand } = await import('./status.js');
          const cmd = new StatusCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'visit': {
          const { default: VisitCommand } = await import('./visit.js');
          const cmd = new VisitCommand([], this.config);
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
        case 'themes': {
          const { default: ThemesCommand } = await import('./themes/index.js');
          const cmd = new ThemesCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'restart': {
          const { default: RestartCommand } = await import('./restart.js');
          const cmd = new RestartCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'rebuild': {
          const { default: RebuildCommand } = await import('./rebuild.js');
          const cmd = new RebuildCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'shell': {
          const { default: ShellCommand } = await import('./shell.js');
          const cmd = new ShellCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute agent ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}