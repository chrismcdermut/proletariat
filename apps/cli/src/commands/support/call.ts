import { Command } from '@oclif/core';
import chalk from 'chalk';
import { exec } from 'child_process';
import { styles } from '../../lib/styles.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

const CAL_URL = 'https://cal.com/chrismcdermut';

function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export default class SupportCall extends Command {
  static description = 'Book a call for setup help or feedback';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SupportCall);

    // Check if machine output mode is active
    const jsonMode = isMachineOutput(flags);

    // In JSON mode, output the URL
    if (jsonMode) {
      outputSuccessAsJson(
        {
          url: CAL_URL,
          message: 'Calendar booking URL',
        },
        createMetadata('support call', flags)
      );
      return;
    }

    this.log(styles.muted('Opening calendar booking...\n'));
    this.log(chalk.cyan(`  ${CAL_URL}`));
    this.log('');

    try {
      await openUrl(CAL_URL);
      this.log(chalk.green('  ✓ Opened in your browser'));
    } catch {
      this.log(styles.muted('  Could not open browser automatically.'));
      this.log(styles.muted('  Please open the URL above manually.'));
    }
  }
}
