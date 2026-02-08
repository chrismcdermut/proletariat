import { Command } from '@oclif/core';
import { execSync } from 'node:child_process';
import { styles } from '../../lib/styles.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { SUPPORT_URLS } from './index.js';

export default class SupportDocs extends Command {
  static description = 'Open documentation in browser';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SupportDocs);

    const url = SUPPORT_URLS.docs;

    // In JSON mode, return the URL
    if (isMachineOutput(flags)) {
      outputSuccessAsJson(
        {
          action: 'docs',
          url,
          message: 'Open documentation',
        },
        createMetadata('support docs', flags)
      );
      return;
    }

    // Open the URL in the browser
    this.openUrl(url);
    this.log(styles.success('Opening documentation...'));
    this.log(styles.muted(`URL: ${url}`));
  }

  private openUrl(url: string): void {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        execSync(`open "${url}"`);
      } else if (platform === 'linux') {
        execSync(`xdg-open "${url}"`);
      } else if (platform === 'win32') {
        execSync(`start "" "${url}"`);
      }
    } catch {
      this.log(styles.warning('Could not open browser automatically.'));
      this.log(styles.info(`Please visit: ${url}`));
    }
  }
}
