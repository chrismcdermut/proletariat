import { Command, Args } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  findWorkspacesByName,
  findWorkspaceByPath,
  unregisterWorkspace,
  normalizePath,
  getActiveWorkspace,
} from '../../lib/machine-config.js';

export default class WorkspaceRemove extends Command {
  static description = 'Unregister a workspace from the machine config (does NOT delete files)';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-workspace',
    '<%= config.bin %> <%= command.id %> /path/to/workspace',
  ];

  static args = {
    nameOrPath: Args.string({
      description: 'Workspace name or path to unregister',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WorkspaceRemove);
    const input = args.nameOrPath;

    // Resolve workspace path
    const workspacePath = await this.resolveWorkspacePath(input);

    // Check if this is the active workspace
    const activeWorkspace = getActiveWorkspace();
    const wasActive = activeWorkspace === workspacePath;

    // Unregister the workspace
    const removed = unregisterWorkspace(workspacePath);

    if (removed) {
      this.log(chalk.green(`Unregistered workspace: ${workspacePath}`));
      this.log(chalk.gray('Note: Files were NOT deleted, only removed from registry.'));

      if (wasActive) {
        this.log(chalk.yellow('This was the active workspace. Active workspace has been cleared.'));
        this.log(chalk.gray('Run "prlt workspace use <name>" to set a new active workspace.'));
      }
    } else {
      this.error(`Failed to unregister workspace: ${workspacePath}`);
    }
  }

  private async resolveWorkspacePath(input: string): Promise<string> {
    // First, try to find by path
    const normalizedPath = normalizePath(input);
    const byPath = findWorkspaceByPath(normalizedPath);
    if (byPath) {
      return byPath.path;
    }

    // Try to find by name
    const matches = findWorkspacesByName(input);

    if (matches.length === 0) {
      this.error(`Workspace not found: ${input}`);
    }

    if (matches.length === 1) {
      return matches[0].path;
    }

    // Multiple workspaces with same name - prompt user to choose
    this.log(chalk.yellow(`Multiple workspaces found with name "${input}":`));

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Which workspace do you want to remove?',
        choices: matches.map((w) => ({
          name: `${w.name} - ${w.path}`,
          value: w.path,
        })),
      },
    ]);

    return selected;
  }
}
