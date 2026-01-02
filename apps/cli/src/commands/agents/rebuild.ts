import { Args, Command, Flags } from '@oclif/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';

const execAsync = promisify(exec);

export default class AgentsRebuild extends Command {
  static description = 'Rebuild agent devcontainer images';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %> altman andreesen',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Rebuild all agent containers',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build without using cache',
      default: false,
    }),
  };

  static args = {
    agents: Args.string({
      description: 'Agent name(s) to rebuild',
      required: false,
    }),
  };

  static strict = false;

  async run(): Promise<void> {
    const { args, argv, flags } = await this.parse(AgentsRebuild);

    // Get workspace info
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      this.error('Not in a proletariat workspace. Run `prlt init` first.');
    }

    let agentsToRebuild: string[] = [];

    if (flags.all) {
      agentsToRebuild = workspaceInfo.agents.map((a: any) => a.name);
    } else {
      // Collect agent names from variadic args
      const agentNames = argv as string[];
      if (agentNames.length === 0) {
        // No args provided - prompt user to select agents
        if (workspaceInfo.agents.length === 0) {
          this.error('No agents found in workspace');
        }

        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select agents to rebuild:',
          choices: [
            ...workspaceInfo.agents.map((a: any) => ({ name: a.name, value: a.name })),
            new inquirer.Separator(),
            { name: 'All agents', value: '__all__' }
          ],
          validate: (input) => input.length > 0 || 'Please select at least one agent'
        }]);

        if (selected.includes('__all__')) {
          agentsToRebuild = workspaceInfo.agents.map((a: any) => a.name);
        } else {
          agentsToRebuild = selected;
        }
      } else {
        agentsToRebuild = agentNames;
      }
    }

    if (agentsToRebuild.length === 0) {
      this.log(colors.warning('No agents to rebuild'));
      return;
    }

    this.log(colors.primary(`🔨 Rebuilding ${agentsToRebuild.length} agent container(s)...\n`));

    const agentsPath = path.join(workspaceInfo.path, 'agents', 'staff');

    // Rebuild containers
    for (const agentName of agentsToRebuild) {
      try {
        const agentDir = path.join(agentsPath, agentName);
        const devcontainerPath = path.join(agentDir, '.devcontainer');

        this.log(colors.textSecondary(`  ${agentName}: Building devcontainer...`));

        const buildCommand = [
          'devcontainer',
          'build',
          '--workspace-folder',
          agentDir,
        ];

        if (flags['no-cache']) {
          buildCommand.push('--no-cache');
        }

        const { stdout, stderr } = await execAsync(buildCommand.join(' '));

        if (stderr && !stderr.includes('WARNING')) {
          this.log(colors.textMuted(`    ${stderr.trim()}`));
        }

        this.log(colors.success(`  ${agentName}: ✓ Build complete`));
      } catch (error) {
        this.log(colors.error(`  ${agentName}: ✗ Failed to rebuild: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    this.log('');
    this.log(colors.primary('✨ Rebuild complete!'));
    this.log(colors.textMuted('Use `prlt agents restart` to apply changes to running containers'));
  }
}
