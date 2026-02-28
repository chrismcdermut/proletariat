import { Command, Flags } from '@oclif/core';
import { execSync } from 'node:child_process';
import { styles } from '../../lib/styles.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { SUPPORT_URLS } from './index.js';

export default class SupportIssues extends Command {
  static description = 'Browse GitHub Issues';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --browser',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
    browser: Flags.boolean({
      description: 'Open issues in browser (default behavior)',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SupportIssues);

    const url = SUPPORT_URLS.issues;

    // In JSON mode, return the URL
    if (isMachineOutput(flags)) {
      outputSuccessAsJson(
        {
          action: 'issues',
          url,
          message: 'Browse GitHub Issues',
        },
        createMetadata('support issues', flags)
      );
      return;
    }

    // Open in browser (default)
    if (flags.browser) {
      this.openUrl(url);
      this.log(styles.success('Opening GitHub Issues...'));
      this.log(styles.muted(`URL: ${url}`));
    } else {
      // List issues via gh CLI when --no-browser is set
      try {
        const output = execSync('gh issue list --repo chrismcdermut/proletariat', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.log(styles.header('Open Issues'));
        this.log(output.trim() || styles.muted('No open issues found.'));
      } catch {
        this.log(styles.warning('Could not list issues via gh CLI.'));
        this.log(styles.info(`Please visit: ${url}`));
      }
    }
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
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch {
      this.log(styles.warning('Could not open browser automatically.'));
      this.log(styles.info(`Please visit: ${url}`));
    }
  }
}
