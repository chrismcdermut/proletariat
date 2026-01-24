import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { findAllHQs, findHQRootWithSource, isValidHQ } from '../../lib/workspace.js';
import {
  getRegisteredWorkspaces,
  getActiveWorkspace,
} from '../../lib/machine-config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface WorkspaceInfo {
  name: string;
  path: string;
  isActive: boolean;
  exists: boolean;
  hasPMO: boolean;
  registeredAt?: string;
  source?: 'registry' | 'discovered';
}

export default class WorkspaceList extends Command {
  static description = 'List all registered and discovered HQ workspaces';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON for machine-readable format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspaceList);
    const cwd = process.cwd();

    // Get registered workspaces from machine config
    const registeredWorkspaces = getRegisteredWorkspaces();
    const activeWorkspacePath = getActiveWorkspace();

    // Also find any workspaces in directory tree (for backward compatibility)
    const discoveredHQs = findAllHQs(cwd);

    // Get the current active workspace (from findHQRootWithSource)
    const currentWorkspace = findHQRootWithSource(cwd);

    // Build unified workspace list
    const workspaces: WorkspaceInfo[] = [];
    const seenPaths = new Set<string>();

    // Add registered workspaces first
    for (const workspace of registeredWorkspaces) {
      const exists = fs.existsSync(workspace.path);
      const isActive = activeWorkspacePath === workspace.path ||
        currentWorkspace?.path === workspace.path;

      let hasPMO = false;
      if (exists) {
        const dbPath = path.join(workspace.path, '.proletariat', 'workspace.db');
        hasPMO = fs.existsSync(dbPath);
      }

      workspaces.push({
        name: workspace.name,
        path: workspace.path,
        isActive,
        exists,
        hasPMO,
        registeredAt: workspace.registeredAt,
        source: 'registry',
      });

      seenPaths.add(workspace.path);
    }

    // Add discovered workspaces that aren't in the registry
    for (const hqPath of discoveredHQs) {
      if (seenPaths.has(hqPath)) continue;

      // Get workspace info
      const configPath = path.join(hqPath, '.proletariat', 'config.json');
      let workspaceName = path.basename(hqPath);

      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          workspaceName = config.name || workspaceName;
        } catch {
          // Use defaults
        }
      }

      // Check if it has PMO
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      const hasPMO = fs.existsSync(dbPath);
      const isActive = currentWorkspace?.path === hqPath;

      workspaces.push({
        name: workspaceName,
        path: hqPath,
        isActive,
        exists: true,
        hasPMO,
        source: 'discovered',
      });
    }

    // JSON output
    if (flags.json) {
      const output = {
        workspaces: workspaces.map((w) => ({
          name: w.name,
          path: w.path,
          active: w.isActive,
          exists: w.exists,
          hasPMO: w.hasPMO,
          registeredAt: w.registeredAt,
          source: w.source,
        })),
        activeWorkspace: activeWorkspacePath,
        envOverride: process.env.PRLT_HQ_PATH || null,
      };
      this.log(JSON.stringify(output, null, 2));
      return;
    }

    // Human-readable output
    if (workspaces.length === 0) {
      this.log(chalk.yellow('No workspaces found.'));
      this.log(chalk.gray('Run "prlt init" to create a new workspace.'));
      return;
    }

    this.log(chalk.blue('\nRegistered workspaces:\n'));

    for (const workspace of workspaces) {
      const activeMarker = workspace.isActive ? chalk.green(' (active)') : '';
      const envMarker = workspace.isActive && currentWorkspace?.source === 'env'
        ? chalk.cyan(' [via PRLT_HQ_PATH]')
        : '';
      const pmoMarker = workspace.hasPMO
        ? chalk.gray(' [has PMO]')
        : chalk.gray(' [no PMO]');
      const unregisteredMarker = workspace.source === 'discovered'
        ? chalk.yellow(' [not registered]')
        : '';

      if (!workspace.exists) {
        // Warning for stale registration
        this.log(
          `  ${chalk.red('⚠')} ${chalk.strikethrough(chalk.white(workspace.name))}${activeMarker}`
        );
        this.log(chalk.red(`    Path no longer exists: ${workspace.path}`));
      } else {
        this.log(
          `  ${chalk.white(workspace.name)}${activeMarker}${envMarker}${pmoMarker}${unregisteredMarker}`
        );
        this.log(chalk.gray(`    Path: ${workspace.path}`));
      }
      this.log('');
    }

    // Show warning for unregistered workspaces
    const unregistered = workspaces.filter((w) => w.source === 'discovered');
    if (unregistered.length > 0) {
      this.log(chalk.yellow('Some workspaces are not registered.'));
      this.log(chalk.gray('Run "prlt workspace add <path>" to register them.'));
      this.log('');
    }

    // Show helpful hints if multiple workspaces found
    const registeredCount = workspaces.filter((w) => w.source === 'registry').length;
    if (registeredCount > 1) {
      this.log(chalk.gray('To switch workspaces, run:'));
      this.log(chalk.cyan('  prlt workspace use <name|path>'));
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
