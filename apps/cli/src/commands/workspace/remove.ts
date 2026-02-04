import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { PromptCommand } from '../../lib/prompt-command.js';
import {
  findWorkspacesByName,
  findWorkspaceByPath,
  unregisterWorkspace,
  normalizePath,
  getActiveWorkspace,
} from '../../lib/machine-config.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class WorkspaceRemove extends PromptCommand {
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

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceRemove);

    const input = args.nameOrPath;

    // Resolve workspace path
    const workspacePath = await this.resolveWorkspacePath(input, flags);

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

  private async resolveWorkspacePath(input: string, flags: Record<string, unknown> = {}): Promise<string> {
    // First, try to find by path
    const normalizedPath = normalizePath(input);
    const byPath = findWorkspaceByPath(normalizedPath);
    if (byPath) {
      return byPath.path;
    }

    // Try to find by name
    const matches = findWorkspacesByName(input);

    if (matches.length === 0) {
      if (shouldOutputJson(flags as { json?: boolean })) {
        outputErrorAsJson('WORKSPACE_NOT_FOUND', `Workspace not found: ${input}`, createMetadata('workspace remove', flags));
        this.exit(1);
      }
      this.error(`Workspace not found: ${input}`);
    }

    if (matches.length === 1) {
      return matches[0].path;
    }

    // Build choices with command field for agent navigation
    const workspaceChoices = matches.map((w) => ({
      name: `${w.name} - ${w.path}`,
      value: w.path,
      command: `prlt workspace remove "${w.path}" --json`,
    }));

    const jsonModeConfig = { flags: flags as Record<string, unknown> & { json?: boolean }, commandName: 'workspace remove' };

    // this.prompt() handles both modes:
    // - JSON mode: outputs prompt config as JSON and exits
    // - Interactive mode: shows inquirer menu
    const { selected } = await this.prompt<{ selected: string }>([
      {
        type: 'list',
        name: 'selected',
        message: `Multiple workspaces found with name "${input}". Which workspace do you want to remove?`,
        choices: workspaceChoices,
      },
    ], jsonModeConfig);

    return selected;
  }
}
