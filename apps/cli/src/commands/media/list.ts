import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { getWorkspaceMediaInfo, formatDuration } from '../../lib/media/index.js';
import { isNonTTY, shouldOutputJson, outputErrorAsJson, createMetadata } from '../../lib/prompt-json.js';
import { visualPadEnd } from '../../lib/string-utils.js';

export default class List extends PMOCommand {
  static description = 'List all media files in the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
  ];

  static flags = {
    ...pmoBaseFlags,
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(List);

    if (flags.format === 'table' && isNonTTY()) {
      flags.format = 'json';
    }

    const jsonMode = shouldOutputJson(flags);

    const hqPath = findHQRoot();
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt new" first.', createMetadata('media list', flags));
      }
      this.error('Not in an HQ directory. Run "prlt new" first.');
    }

    const { media } = getWorkspaceMediaInfo();

    if (media.length === 0) {
      this.log(colors.warning('No media found. Add some with "prlt media add <path>"'));
      return;
    }

    if (flags.format === 'json') {
      this.log(JSON.stringify(media, null, 2));
      return;
    }

    if (flags.format === 'compact') {
      for (const item of media) {
        const icon = item.mediaType === 'video' ? '🎬' : '🎵';
        const duration = item.durationSeconds ? formatDuration(item.durationSeconds) : 'unknown';
        this.log(`${icon} ${item.name} (${item.status}, ${duration}, ${item.frameCount} frames)`);
      }
      return;
    }

    // Table format
    this.log(format.title(`🎬 Media (${media.length})`));
    this.log('');

    this.log(colors.textMuted(
      visualPadEnd('Name', 25) +
      visualPadEnd('Type', 8) +
      visualPadEnd('Status', 12) +
      visualPadEnd('Duration', 12) +
      visualPadEnd('Frames', 8) +
      'Transcript'
    ));
    this.log(colors.textMuted('─'.repeat(75)));

    for (const item of media) {
      const statusColor = item.status === 'ready' ? colors.success :
                          item.status === 'error' ? colors.error :
                          item.status === 'processing' ? colors.warning :
                          colors.textMuted;
      const duration = item.durationSeconds ? formatDuration(item.durationSeconds) : '-';
      const transcript = item.hasTranscript ? '✓' : '-';

      this.log(
        colors.text(visualPadEnd(item.name, 25)) +
        colors.textMuted(visualPadEnd(item.mediaType, 8)) +
        statusColor(visualPadEnd(item.status, 12)) +
        colors.text(visualPadEnd(duration, 12)) +
        colors.text(visualPadEnd(String(item.frameCount), 8)) +
        colors.text(transcript)
      );
    }

    this.log('');
    const readyCount = media.filter(m => m.status === 'ready').length;
    const errorCount = media.filter(m => m.status === 'error').length;

    this.log(format.subtitle('Summary:'));
    this.log(colors.text(`  ${media.length} media item(s)`));
    if (readyCount > 0) {
      this.log(colors.success(`  ${readyCount} ready`));
    }
    if (errorCount > 0) {
      this.log(colors.error(`  ${errorCount} with errors`));
    }
  }
}
