
import { colors } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson, outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js';

export default class Agent extends PMOCommand {
  static description = 'Manage agents in the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> status camry',
    '<%= config.bin %> <%= command.id %> visit tacoma',
    '<%= config.bin %> <%= command.id %> staff add',
    '<%= config.bin %> <%= command.id %> staff remove camry',
    '<%= config.bin %> <%= command.id %> cleanup --temp',
    '<%= config.bin %> <%= command.id %> restart altman',
    '<%= config.bin %> <%= command.id %> rebuild altman',
    '<%= config.bin %> <%= command.id %> shell altman',
    '<%= config.bin %> <%= command.id %> themes list',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Agent);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    this.log(colors.primary('🤖 Agent Management'));
    this.log('');
    this.log(colors.textMuted('Note: Agent pre-registration is no longer required!'));
    this.log(colors.textMuted('Use "prlt work spawn" to create ephemeral agents automatically.'));
    this.log('');

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'agent' } : null;

    // Use agentPrompt for unified JSON/interactive handling
    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        // View/Info group
        { name: '📋 List all agents', value: 'list', command: 'prlt agent list --machine' },
        { name: '📊 Show status', value: 'status', command: 'prlt agent status --machine' },
        { name: '📂 Visit directory', value: 'visit', command: 'prlt agent visit --machine' },
        { name: '🗑️  Remove agent', value: 'remove', command: 'prlt agent remove --machine' },
        // Management group
        { name: '👔 Manage staff agents', value: 'staff', command: 'prlt agent staff --machine' },
        { name: '⏱️  Manage temp agents', value: 'temp', command: 'prlt agent temp --machine' },
        { name: '🧹 Cleanup agents', value: 'cleanup', command: 'prlt agent cleanup --machine' },
        { name: '🎨 Manage themes', value: 'themes', command: 'prlt agent themes --machine' },
        // Operations group
        { name: '🐚 Open shell', value: 'shell', command: 'prlt agent shell --machine' },
        { name: '🔄 Restart', value: 'restart', command: 'prlt agent restart --machine' },
        { name: '🔨 Rebuild', value: 'rebuild', command: 'prlt agent rebuild --machine' },
        { name: '🔍 Discover agents on disk', value: 'discover', command: 'prlt agent discover --machine' },
        // Cancel
        { name: '❌ Cancel', value: 'cancel', command: '' },
      ],
    }], agentConfig);

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
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
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
          // @ts-expect-error -- temp subcommand not yet implemented
          // eslint-disable-next-line import/no-unresolved -- temp subcommand not yet implemented
          const { default: TempCommand } = await import('./temp/index.js');
          const cmd = new TempCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'cleanup': {
          const { default: CleanupCommand } = await import('./cleanup.js');
          const cmd = new CleanupCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'themes': {
          const { default: ThemeCommand } = await import('./themes/index.js');
          const cmd = new ThemeCommand([], this.config);
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
        case 'discover': {
          const { default: DiscoverCommand } = await import('./discover.js');
          const cmd = new DiscoverCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          if (jsonMode) {
            outputErrorAsJson('UNKNOWN_ACTION', `Unknown action: ${action}`, createMetadata('agent', flags));
          }
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('EXECUTION_FAILED', `Failed to execute agent ${action}: ${error instanceof Error ? error.message : String(error)}`, createMetadata('agent', flags));
      }
      this.error(`Failed to execute agent ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}