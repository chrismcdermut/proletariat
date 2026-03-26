
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Repo extends PromptCommand {
  static description = 'Repository management operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add /path/to/repo',
    '<%= config.bin %> <%= command.id %> remove my-repo',
    '<%= config.bin %> <%= command.id %> view my-repo',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Repo);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices for both modes
    const menuChoices = [
      { name: 'List all repositories', value: 'list', command: 'prlt repo list --json' },
      { name: 'Add repository', value: 'add', command: 'prlt repo add --json' },
      { name: 'Create GitHub repository', value: 'create', command: 'prlt repo create --json' },
      { name: 'Remove repository', value: 'remove', command: 'prlt repo remove --json' },
      { name: 'View repository details', value: 'view', command: 'prlt repo view --json' },
      { name: 'Add multiple repositories', value: 'add-bulk', command: 'prlt repo add --bulk --json' },
      { name: 'Remove multiple repositories', value: 'remove-bulk', command: 'prlt repo remove --bulk --json' },
    ];

    // Only show header in interactive mode
    if (!jsonMode) {
      this.log(colors.primary('📦 Repository Operations'));
      this.log('');
    }

    // Use prompt for JSON mode support
    const agentConfig = jsonMode ? { flags, commandName: 'repo' } : null;

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: menuChoices,
    }], agentConfig);

    // In JSON mode, prompt exits after outputting - this is never reached
    if (!action || action === 'cancel') {
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
        case 'create': {
          const { default: CreateCommand } = await import('./create.js');
          const cmd = new CreateCommand([], this.config);
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
