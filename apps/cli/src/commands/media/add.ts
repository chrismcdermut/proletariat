import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { addMedia, isFfmpegInstalled } from '../../lib/media/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Add extends PMOCommand {
  static description = 'Add a video or audio file to the HQ for preprocessing';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/video.mp4',
    '<%= config.bin %> <%= command.id %> /path/to/video.mp4 --interval 60',
    '<%= config.bin %> <%= command.id %> /path/to/audio.mp3 --no-transcribe',
  ];

  static args = {
    path: Args.string({
      description: 'Path to the media file (video or audio)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    interval: Flags.integer({
      char: 'i',
      description: 'Frame extraction interval in seconds',
      default: 30,
    }),
    transcribe: Flags.boolean({
      description: 'Generate transcript using whisper',
      default: true,
      allowNo: true,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('media add', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const hqPath = findHQRoot();
    if (!hqPath) {
      return handleError('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt new" first.');
    }

    if (!isFfmpegInstalled()) {
      return handleError('FFMPEG_NOT_INSTALLED', 'ffmpeg is not installed. Install it with: brew install ffmpeg');
    }

    let filePath: string;

    if (args.path) {
      filePath = args.path;
    } else {
      if (jsonMode) {
        const agentConfig = { flags, commandName: 'media add' };
        await this.prompt<{ path: string }>([{
          type: 'input',
          name: 'path',
          message: 'Enter path to media file:',
        }], agentConfig);
        return;
      }

      const { path: inputPath } = await this.prompt<{ path: string }>([{
        type: 'input',
        name: 'path',
        message: 'Enter path to media file (video or audio):',
      }]);

      if (!inputPath || !inputPath.trim()) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      filePath = inputPath.trim();
    }

    this.log(colors.primary(`\n🎬 Adding media: ${filePath}\n`));

    const result = await addMedia(hqPath, filePath, {
      interval: flags.interval,
      transcribe: flags.transcribe,
    });

    if (result.success) {
      this.log('');
      this.log(format.success(`Media "${result.name}" added and preprocessed`));
      this.log(colors.textMuted(`  Location: media/${result.name}/`));
      this.log(colors.textMuted(`  View details: prlt media show ${result.name}`));
    } else {
      this.error(`Failed to add media: ${result.error}`);
    }
  }
}
