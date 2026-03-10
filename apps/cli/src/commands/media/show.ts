import { Args } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { showMedia, getWorkspaceMediaInfo, formatDuration, getMediaDir } from '../../lib/media/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Show extends PMOCommand {
  static description = 'Show detailed information about a media item';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-video',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Media item name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Show);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('media show', flags));
        this.exit(1);
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
        return handleError('NO_MEDIA', 'No media found. Add some with "prlt media add <path>"');
      }

      const selected = await this.selectFromList({
        message: 'Select media to view:',
        items: media,
        getName: (m) => `${m.name} (${m.status}${m.frameCount > 0 ? `, ${m.frameCount} frames` : ''})`,
        getValue: (m) => m.name,
        getCommand: (m) => `prlt media show ${m.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'media show' } : null,
        allowCancel: true,
      });

      if (!selected) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      mediaName = selected;
    }

    const item = showMedia(hqPath, mediaName);
    if (!item) {
      return handleError('MEDIA_NOT_FOUND', `Media "${mediaName}" not found.`);
    }

    if (jsonMode) {
      this.log(JSON.stringify(item, null, 2));
      return;
    }

    // Display details
    const icon = item.media_type === 'video' ? '🎬' : '🎵';
    this.log(format.title(`${icon} Media: ${item.name}`));
    this.log('');

    this.log(`Path:        ${colors.path(item.path)}`);
    if (item.source_path) {
      this.log(`Source:      ${colors.text(item.source_path)}`);
    }
    this.log(`Type:        ${colors.text(item.media_type)}`);
    this.log(`Added:       ${colors.text(new Date(item.added_at).toLocaleString())}`);

    const statusColor = item.status === 'ready' ? colors.success :
                        item.status === 'error' ? colors.error :
                        item.status === 'processing' ? colors.warning :
                        colors.textMuted;
    this.log(`Status:      ${statusColor(item.status)}`);

    if (item.error_message) {
      this.log(`Error:       ${colors.error(item.error_message)}`);
    }

    if (item.duration_seconds) {
      this.log(`Duration:    ${colors.text(formatDuration(item.duration_seconds))}`);
    }
    if (item.resolution) {
      this.log(`Resolution:  ${colors.text(item.resolution)}`);
    }

    this.log(format.subtitle('\n📊 Preprocessed Assets:'));
    this.log(`  Frames:      ${colors.text(String(item.frame_count))} (every ${item.frame_interval}s)`);
    this.log(`  Transcript:  ${item.has_transcript ? colors.success('✓ Available') : colors.textMuted('Not generated')}`);

    // Show frames info
    const framesDir = path.join(getMediaDir(hqPath), item.name, 'frames');
    if (fs.existsSync(framesDir)) {
      const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
      if (frameFiles.length > 0) {
        this.log(format.subtitle('\n🖼️  Frames:'));
        const maxShow = Math.min(frameFiles.length, 10);
        for (let i = 0; i < maxShow; i++) {
          this.log(colors.textMuted(`  • ${frameFiles[i]}`));
        }
        if (frameFiles.length > maxShow) {
          this.log(colors.textMuted(`  ... and ${frameFiles.length - maxShow} more`));
        }
      }
    }

    // Show manifest info
    const manifestPath = path.join(getMediaDir(hqPath), item.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      this.log(colors.textMuted(`\nManifest:    media/${item.name}/manifest.json`));
    }

    if (item.processed_at) {
      this.log(colors.textMuted(`Processed:   ${new Date(item.processed_at).toLocaleString()}`));
    }
  }
}
