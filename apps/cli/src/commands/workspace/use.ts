import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'node:fs';
import { isValidHQ } from '../../lib/workspace.js';
import {
  findWorkspacesByName,
  findWorkspaceByPath,
  setActiveWorkspace,
  normalizePath,
  getRegisteredWorkspaces,
} from '../../lib/machine-config.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class WorkspaceUse extends Command {
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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceUse);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('workspace use', flags));
        this.exit(1);
      }
      this.error(message);
    };

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
        // Build choices once, use for both JSON and interactive modes
        const workspaceChoices = matches.map((w) => ({
          name: `${w.name} - ${w.path}`,
          value: w.path,
        }));
        const message = `Multiple workspaces found with name "${input}". Which workspace do you want to use?`;

        // In JSON mode, output workspace selection prompt
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'workspacePath', message, workspaceChoices),
            createMetadata('workspace use', flags)
          );
          return;
        }

        // Multiple workspaces with same name - prompt user to choose
        this.log(chalk.yellow(`Multiple workspaces found with name "${input}":`));

        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Which workspace do you want to use?',
            choices: workspaceChoices,
          },
        ]);

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
