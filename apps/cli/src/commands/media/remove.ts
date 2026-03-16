import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { removeMedia, getWorkspaceMediaInfo, showMedia } from '../../lib/media/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Remove extends PMOCommand {
  static description = 'Remove a media item from the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-video',
    '<%= config.bin %> <%= command.id %> my-video --force',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Media item name to remove',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('media remove', flags));
        return
      }
      this.error(message);
    };

    const hqPath = findHQRoot();
    if (!hqPath) {
      return handleError('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt new" first.');
    }

    let mediaName: string | null = args.name || null;

    if (!mediaName) {
      const { media } = getWorkspaceMediaInfo();
      if (media.length === 0) {
        return handleError('NO_MEDIA', 'No media found.');
      }

      const selected = await this.selectFromList({
        message: 'Select media to remove:',
        items: media,
        getName: (m) => m.name,
        getValue: (m) => m.name,
        getCommand: (m) => `prlt media remove ${m.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'media remove' } : null,
        allowCancel: true,
      });

      if (!selected) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      mediaName = selected;
    }

    // Validate media exists
    const item = showMedia(hqPath, mediaName);
    if (!item) {
      return handleError('MEDIA_NOT_FOUND', `Media "${mediaName}" not found.`);
    }

    // Confirmation unless --force
    if (!flags.force) {
      const agentConfig = jsonMode ? { flags, commandName: 'media remove' } : null;

      this.log(colors.warning('\n⚠️  This will:'));
      this.log(colors.text(`  • Remove media/${mediaName}/ directory (source + preprocessed assets)`));
      this.log(colors.text('  • Update database\n'));

      const { confirm } = await this.prompt<{ confirm: string }>([{
        type: 'list',
        name: 'confirm',
        message: `Are you sure you want to remove "${mediaName}"?`,
        choices: [
          { name: 'No, cancel', value: 'false', command: '' },
          { name: 'Yes, remove media', value: 'true', command: `prlt media remove ${mediaName} --force --json` },
        ],
      }], agentConfig);

      if (confirm !== 'true') {
        this.log(colors.textMuted('Removal cancelled.'));
        return;
      }
    }

    this.log(colors.primary(`\nRemoving media "${mediaName}"...`));

    const result = removeMedia(hqPath, mediaName);

    if (result.success) {
      this.log(format.success(`Media ${mediaName} removed`));
    } else {
      if (jsonMode) {
        outputErrorAsJson('REMOVE_FAILED', `Failed to remove media: ${result.error}`, createMetadata('media remove', flags));
        return
      }
      this.error(`Failed to remove media: ${result.error}`);
    }
  }
}
