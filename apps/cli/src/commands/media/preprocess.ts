import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { preprocessMedia, getWorkspaceMediaInfo, isFfmpegInstalled } from '../../lib/media/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Preprocess extends PMOCommand {
  static description = 'Re-run preprocessing on a media item with different settings';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-video',
    '<%= config.bin %> <%= command.id %> my-video --interval 60',
    '<%= config.bin %> <%= command.id %> my-video --no-transcribe',
  ];

  static args = {
    name: Args.string({
      description: 'Media item name to preprocess',
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
    const { args, flags } = await this.parse(Preprocess);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('media preprocess', flags));
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

    let mediaName: string | null = args.name || null;

    if (!mediaName) {
      const { media } = getWorkspaceMediaInfo();
      if (media.length === 0) {
        return handleError('NO_MEDIA', 'No media found. Add some with "prlt media add <path>"');
      }

      const selected = await this.selectFromList({
        message: 'Select media to preprocess:',
        items: media,
        getName: (m) => `${m.name} (${m.status})`,
        getValue: (m) => m.name,
        getCommand: (m) => `prlt media preprocess ${m.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'media preprocess' } : null,
        allowCancel: true,
      });

      if (!selected) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      mediaName = selected;
    }

    this.log(colors.primary(`\n🔄 Preprocessing "${mediaName}"...`));
    this.log(colors.textMuted(`  Interval: ${flags.interval}s, Transcribe: ${flags.transcribe}\n`));

    const result = await preprocessMedia(hqPath, mediaName, {
      interval: flags.interval,
      transcribe: flags.transcribe,
    });

    if (result.success) {
      this.log('');
      this.log(format.success(`Preprocessing complete for "${mediaName}"`));
      this.log(colors.textMuted(`  View details: prlt media show ${mediaName}`));
    } else {
      this.log('');
      this.log(format.error(`Preprocessing had issues: ${result.error}`));
    }
  }
}
