import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidHQ } from '../../lib/workspace.js';
import {
  registerWorkspace,
  normalizePath,
  isWorkspaceRegistered,
  getWorkspaceNameFromPath,
} from '../../lib/machine-config.js';

export default class WorkspaceAdd extends Command {
  static description = 'Register an existing workspace in the machine config';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/workspace',
    '<%= config.bin %> <%= command.id %> . --name my-workspace',
    '<%= config.bin %> <%= command.id %> ~/projects/my-hq',
  ];

  static args = {
    path: Args.string({
      description: 'Path to the workspace to register',
      required: true,
    }),
  };

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'Custom name for the workspace (defaults to directory basename or workspace config name)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceAdd);

    // Normalize the path
    const workspacePath = normalizePath(args.path);

    // Check if path exists
    if (!fs.existsSync(workspacePath)) {
      this.error(`Path does not exist: ${workspacePath}`);
    }

    // Check if it's a directory
    const stats = fs.statSync(workspacePath);
    if (!stats.isDirectory()) {
      this.error(`Path is not a directory: ${workspacePath}`);
    }

    // Validate it's a valid HQ workspace
    const configPath = path.join(workspacePath, '.proletariat', 'config.json');
    if (!fs.existsSync(configPath)) {
      this.error(
        `Not a valid workspace: missing .proletariat/config.json\n` +
          `Run "prlt init" to create a new workspace.`
      );
    }

    // Read config to validate type
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.type !== 'hq') {
        this.error(
          `Invalid workspace type: ${config.type}\n` +
            `Only HQ workspaces can be registered.`
        );
      }
    } catch (error) {
      this.error(`Failed to read workspace config: ${(error as Error).message}`);
    }

    // Check if already registered
    if (isWorkspaceRegistered(workspacePath)) {
      this.log(chalk.yellow(`Workspace is already registered: ${workspacePath}`));
      this.log(chalk.gray('Use "prlt workspace use" to set it as active.'));
      return;
    }

    // Determine workspace name
    const workspaceName = flags.name || getWorkspaceNameFromPath(workspacePath);

    // Register the workspace
    try {
      const entry = registerWorkspace(workspacePath, workspaceName, true);
      this.log(chalk.green(`Registered workspace: ${entry.name}`));
      this.log(chalk.gray(`  Path: ${entry.path}`));
      this.log(chalk.gray(`  Registered at: ${entry.registeredAt}`));
    } catch (error) {
      this.error(`Failed to register workspace: ${(error as Error).message}`);
    }
  }
}
