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
    '<%= config.bin %> <%= command.id %> staff add',
    '<%= config.bin %> <%= command.id %> staff remove camry',
    '<%= config.bin %> <%= command.id %> temp cleanup --temp',
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
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Agent);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'list', name: 'List all agents', command: 'prlt agent list --format json' },
      { id: 'status', name: 'Show status', command: 'prlt agent status --json' },
      { id: 'visit', name: 'Visit directory', command: 'prlt agent visit --json' },
      { id: 'staff', name: 'Manage staff agents', command: 'prlt agent staff --json' },
      { id: 'temp', name: 'Manage temp agents', command: 'prlt agent temp --json' },
      { id: 'themes', name: 'Manage themes', command: 'prlt agent themes --json' },
      { id: 'shell', name: 'Open shell', command: 'prlt agent shell --json' },
      { id: 'restart', name: 'Restart', command: 'prlt agent restart --json' },
      { id: 'rebuild', name: 'Rebuild', command: 'prlt agent rebuild --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'What would you like to do?';

    this.log(colors.primary('🤖 Agent Management'));
    this.log('');
    this.log(colors.textMuted('Note: Agent pre-registration is no longer required!'));
    this.log(colors.textMuted('Use "prlt work spawn" to create ephemeral agents automatically.'));
    this.log('');

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'agent' } : null,
    });

    if (action === 'cancel' || !action) {
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
        case 'staff': {
          const { default: StaffCommand } = await import('./staff/index.js');
          const cmd = new StaffCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'temp': {
          const { default: TempCommand } = await import('./temp/index.js');
          const cmd = new TempCommand([], this.config);
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