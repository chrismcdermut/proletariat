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

const DOCS_URL = 'https://chrismcdermut.github.io/proletariat/';

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

export default class SupportDocs extends Command {
  static description = 'Open the prlt documentation in your browser';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SupportDocs);

    // Check if machine output mode is active
    const jsonMode = isMachineOutput(flags);

    // In JSON mode, output the URL
    if (jsonMode) {
      outputSuccessAsJson(
        {
          url: DOCS_URL,
          message: 'Documentation URL',
        },
        createMetadata('support docs', flags)
      );
      return;
    }

    this.log(styles.muted('Opening documentation...\n'));
    this.log(chalk.cyan(`  ${DOCS_URL}`));
    this.log('');

    try {
      await openUrl(DOCS_URL);
      this.log(chalk.green('  ✓ Opened in your browser'));
    } catch {
      this.log(styles.muted('  Could not open browser automatically.'));
      this.log(styles.muted('  Please open the URL above manually.'));
    }
  }
}
