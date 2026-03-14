
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors } from '../../lib/colors.js';
import { shouldOutputJson, outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js';

export default class Media extends PMOCommand {
  static description = 'Media management operations (videos, audio files)';

  static examples = [
    '<%= config.bin %> <%= command.id %> add /path/to/video.mp4',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> show my-video',
    '<%= config.bin %> <%= command.id %> remove my-video',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Media);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List all media', value: 'list', command: 'prlt media list --json' },
      { name: 'Add media file', value: 'add', command: 'prlt media add --json' },
      { name: 'Show media details', value: 'show', command: 'prlt media show --json' },
      { name: 'Remove media', value: 'remove', command: 'prlt media remove --json' },
      { name: 'Reprocess media', value: 'preprocess', command: 'prlt media preprocess --json' },
    ];

    if (!jsonMode) {
      this.log(colors.primary('🎬 Media Operations'));
      this.log('');
    }

    const agentConfig = jsonMode ? { flags, commandName: 'media' } : null;

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: menuChoices,
    }], agentConfig);

    if (!action || action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      this.log(colors.primary(`\nExecuting: media ${action}`));

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
        case 'show': {
          const { default: ShowCommand } = await import('./show.js');
          const cmd = new ShowCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'preprocess': {
          const { default: PreprocessCommand } = await import('./preprocess.js');
          const cmd = new PreprocessCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          if (jsonMode) {
            outputErrorAsJson('UNKNOWN_ACTION', `Unknown action: ${action}`, createMetadata('media', flags));
          }
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('EXECUTION_FAILED', `Failed to execute media ${action}: ${error instanceof Error ? error.message : String(error)}`, createMetadata('media', flags));
      }
      this.error(`Failed to execute media ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
