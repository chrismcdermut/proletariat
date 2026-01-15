import { Command, Args } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { findAllHQs, isValidHQ } from '../../lib/workspace.js';

export default class WorkspaceUse extends Command {
  static description = 'Set the active workspace by path or select from discovered workspaces';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/workspace',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    path: Args.string({
      description: 'Path to workspace to use (optional - will prompt if not provided)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WorkspaceUse);

    let workspacePath: string;

    if (args.path) {
      // Validate the provided path
      const resolvedPath = path.resolve(args.path);
      if (!isValidHQ(resolvedPath)) {
        this.log(chalk.red(`\nError: ${resolvedPath} is not a valid HQ workspace.`));
        this.log(chalk.gray('A valid workspace must have .proletariat/config.json with type="hq"'));
        return;
      }
      workspacePath = resolvedPath;
    } else {
      // Discover workspaces and prompt for selection
      const allHQs = findAllHQs(process.cwd());

      if (allHQs.length === 0) {
        this.log(chalk.yellow('No HQ workspaces found in directory tree.'));
        this.log(chalk.gray('Run "prlt init" to create a new HQ workspace.'));
        return;
      }

      if (allHQs.length === 1) {
        this.log(chalk.blue(`Only one workspace found: ${allHQs[0]}`));
        workspacePath = allHQs[0];
      } else {
        // Prompt user to select a workspace
        const choices = allHQs.map((hq, index) => {
          const configPath = path.join(hq, '.proletariat', 'config.json');
          let name = path.basename(hq);
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.name) {
              name = config.name;
            }
          } catch {
            // Use basename
          }
          return {
            name: `${name} (${hq})`,
            value: hq,
          };
        });

        const { selectedPath } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedPath',
          message: 'Select workspace to use:',
          choices,
        }]);
        workspacePath = selectedPath;
      }
    }

    // Write to global config
    const globalConfigDir = path.join(process.env.HOME || '', '.proletariat');
    const globalConfigPath = path.join(globalConfigDir, 'config.json');

    // Ensure directory exists
    if (!fs.existsSync(globalConfigDir)) {
      fs.mkdirSync(globalConfigDir, { recursive: true });
    }

    // Read existing config or create new one
    let config: Record<string, unknown> = {};
    if (fs.existsSync(globalConfigPath)) {
      try {
        config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      } catch {
        // Start fresh if config is corrupted
      }
    }

    // Set the default HQ
    config.defaultHQ = workspacePath;
    fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));

    this.log(chalk.green(`\n✓ Active workspace set to: ${workspacePath}`));
    this.log('');
    this.log(chalk.gray('This workspace will be used when no HQ is found in current directory tree.'));
    this.log(chalk.gray('You can also set PRLT_HQ_PATH environment variable to override:'));
    this.log(chalk.cyan(`  export PRLT_HQ_PATH="${workspacePath}"`));
    this.log('');
  }
}
