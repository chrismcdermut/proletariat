import { Command } from '@oclif/core';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { findAllHQs, findHQRootWithSource, isValidHQ } from '../../lib/workspace.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PMO_TABLES } from '../../lib/pmo/schema.js';

const T = PMO_TABLES;

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

      // Check if it has PMO and get stats
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      const hasPMO = fs.existsSync(dbPath);
      let pmoMarker = hasPMO ? chalk.gray(' [has PMO]') : chalk.gray(' [no PMO]');
      let statsLine = '';

      if (hasPMO) {
        const stats = this.getWorkspaceStats(dbPath);
        if (stats.tickets > 0 || stats.specs > 0) {
          statsLine = chalk.gray(`    Stats: ${stats.tickets} tickets, ${stats.specs} specs, ${stats.projects} projects`);
        }
      }

      this.log(`  ${chalk.white(workspaceName)}${marker}${sourceMarker}${pmoMarker}`);
      this.log(chalk.gray(`    Path: ${hqPath}`));
      if (statsLine) {
        this.log(statsLine);
      }
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

  private getWorkspaceStats(dbPath: string): { tickets: number; specs: number; projects: number } {
    const stats = { tickets: 0, specs: 0, projects: 0 };
    try {
      const db = new Database(dbPath);

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.tickets}`).get() as { count: number };
        stats.tickets = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.specs}`).get() as { count: number };
        stats.specs = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.projects}`).get() as { count: number };
        stats.projects = result.count;
      } catch { /* table might not exist */ }

      db.close();
    } catch {
      // Ignore errors
    }
    return stats;
  }
}
