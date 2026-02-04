import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import { PromptCommand } from '../../lib/prompt-command.js';
import { isValidHQ } from '../../lib/workspace.js';
import {
  findWorkspacesByName,
  findWorkspaceByPath,
  setActiveWorkspace,
  normalizePath,
  getRegisteredWorkspaces,
} from '../../lib/machine-config.js';

export default class WorkspaceUse extends PromptCommand {
  static description = 'Set the active workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-workspace',
    '<%= config.bin %> <%= command.id %> /path/to/workspace',
  ];

  static args = {
    nameOrPath: Args.string({
      description: 'Workspace name or path',
      required: true,
    }),
  };

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceUse);

    const input = args.nameOrPath;

    // First, try to find by path
    const normalizedPath = normalizePath(input);
    let workspace = findWorkspaceByPath(normalizedPath);

    if (!workspace) {
      // Try to find by name
      const matches = findWorkspacesByName(input);

      if (matches.length === 0) {
        // Check if input is a valid path that exists but isn't registered
        if (fs.existsSync(normalizedPath) && isValidHQ(normalizedPath)) {
          this.log(chalk.yellow(`Workspace at "${normalizedPath}" exists but is not registered.`));
          this.log(chalk.gray('Run "prlt workspace add" to register it first, or specify a registered workspace.'));
          this.log('');
          this.log(chalk.gray('Registered workspaces:'));
          const registered = getRegisteredWorkspaces();
          if (registered.length === 0) {
            this.log(chalk.gray('  (none)'));
          } else {
            for (const w of registered) {
              this.log(chalk.gray(`  - ${w.name} (${w.path})`));
            }
          }
          this.error('Workspace not registered');
        }

        this.error(`Workspace not found: ${input}`);
      }

      if (matches.length > 1) {
        // Build choices with command field for agent navigation
        const workspaceChoices = matches.map((w) => ({
          name: `${w.name} - ${w.path}`,
          value: w.path,
          command: `prlt workspace use "${w.path}" --json`,
        }));

        const jsonModeConfig = { flags: flags as Record<string, unknown> & { json?: boolean }, commandName: 'workspace use' };

        // this.prompt() handles both modes:
        // - JSON mode: outputs prompt config as JSON and exits
        // - Interactive mode: shows inquirer menu
        const { selected } = await this.prompt<{ selected: string }>([
          {
            type: 'list',
            name: 'selected',
            message: `Multiple workspaces found with name "${input}". Which workspace do you want to use?`,
            choices: workspaceChoices,
          },
        ], jsonModeConfig);

        workspace = matches.find((w) => w.path === selected)!;
      } else {
        workspace = matches[0];
      }
    }

    // Validate workspace still exists on filesystem
    if (!fs.existsSync(workspace.path)) {
      this.error(`Workspace path no longer exists: ${workspace.path}`);
    }

    // Validate it's still a valid HQ
    if (!isValidHQ(workspace.path)) {
      this.error(`Path is no longer a valid workspace: ${workspace.path}`);
    }

    // Set as active workspace
    try {
      setActiveWorkspace(workspace.path);
      this.log(chalk.green(`Active workspace set to: ${workspace.name}`));
      this.log(chalk.gray(`  Path: ${workspace.path}`));
    } catch (error) {
      this.error(`Failed to set active workspace: ${(error as Error).message}`);
    }
  }
}
