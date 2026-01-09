import { Command } from '@oclif/core';
import chalk from 'chalk';
import { findAllHQs, findHQRootWithSource, isValidHQ } from '../../lib/workspace.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export default class WorkspaceList extends Command {
  static description = 'List all discovered HQ workspaces in the directory tree';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    const cwd = process.cwd();

    // Find all HQs in the directory tree
    const allHQs = findAllHQs(cwd);

    // Get the active workspace
    const activeWorkspace = findHQRootWithSource(cwd);

    if (allHQs.length === 0) {
      this.log(chalk.yellow('No HQ workspaces found.'));
      this.log(chalk.gray('Run "prlt init" to create a new HQ workspace.'));
      return;
    }

    this.log(chalk.blue('\nDiscovered HQ workspaces:\n'));

    for (const hqPath of allHQs) {
      const isActive = activeWorkspace?.path === hqPath;
      const marker = isActive ? chalk.green(' (active)') : '';
      const sourceMarker = isActive && activeWorkspace?.source === 'env'
        ? chalk.cyan(' [via PRLT_HQ_PATH]')
        : '';

      // Get workspace info
      const configPath = path.join(hqPath, '.proletariat', 'config.json');
      let workspaceName = path.basename(hqPath);
      let workspaceType = 'hq';

      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          workspaceName = config.name || workspaceName;
          workspaceType = config.type || workspaceType;
        } catch {
          // Use defaults
        }
      }

      // Check if it has PMO
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      const hasPMO = fs.existsSync(dbPath);
      const pmoMarker = hasPMO ? chalk.gray(' [has PMO]') : chalk.gray(' [no PMO]');

      this.log(`  ${chalk.white(workspaceName)}${marker}${sourceMarker}${pmoMarker}`);
      this.log(chalk.gray(`    Path: ${hqPath}`));
      this.log('');
    }

    // Show helpful hints if multiple workspaces found
    if (allHQs.length > 1) {
      this.log(chalk.yellow('Multiple workspaces detected. This can cause confusion.'));
      this.log(chalk.gray('To use a specific workspace, set PRLT_HQ_PATH environment variable:'));
      this.log(chalk.cyan(`  export PRLT_HQ_PATH="${allHQs[0]}"`));
      this.log('');
      this.log(chalk.gray('To consolidate workspaces, run:'));
      this.log(chalk.cyan('  prlt workspace merge <source> --into <target>'));
      this.log('');
    }

    // Show PRLT_HQ_PATH if set
    if (process.env.PRLT_HQ_PATH) {
      this.log(chalk.blue('Current PRLT_HQ_PATH:'));
      this.log(chalk.cyan(`  ${process.env.PRLT_HQ_PATH}`));

      if (!isValidHQ(process.env.PRLT_HQ_PATH)) {
        this.log(chalk.red('  (Warning: This path is not a valid HQ workspace)'));
      }
      this.log('');
    }
  }
}
