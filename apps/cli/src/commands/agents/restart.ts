import { Args, Flags } from '@oclif/core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { DockerCommand } from '../../lib/commands/docker-command.js';

const execAsync = promisify(exec);

export default class AgentsRestart extends DockerCommand {
  static description = 'Restart agent devcontainers';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %> altman andreesen',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Restart all agent containers',
      default: false,
    }),
  };

  static args = {
    agents: Args.string({
      description: 'Agent name(s) to restart',
      required: false,
    }),
  };

  static strict = false;

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AgentsRestart);

    // Get workspace info
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      this.error('Not in a proletariat workspace. Run `prlt init` first.');
    }

    let agentsToRestart: string[] = [];

    if (flags.all) {
      agentsToRestart = workspaceInfo.agents.map((a: any) => a.name);
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
          message: 'Select agents to restart:',
          choices: [
            ...workspaceInfo.agents.map((a: any) => ({ name: a.name, value: a.name })),
            new inquirer.Separator(),
            { name: 'All agents', value: '__all__' }
          ],
          validate: (input) => input.length > 0 || 'Please select at least one agent'
        }]);

        if (selected.includes('__all__')) {
          agentsToRestart = workspaceInfo.agents.map((a: any) => a.name);
        } else {
          agentsToRestart = selected;
        }
      } else {
        agentsToRestart = agentNames;
      }
    }

    if (agentsToRestart.length === 0) {
      this.log(colors.warning('No agents to restart'));
      return;
    }

    this.log(colors.primary(`🔄 Restarting ${agentsToRestart.length} agent container(s)...\n`));

    // Find and stop containers
    for (const agentName of agentsToRestart) {
      try {
        // Find container by agent name
        const { stdout: containers } = await execAsync(`docker ps -a --format "{{.Names}}" | grep -i "${agentName}" || true`);

        const containerNames = containers.trim().split('\n').filter(Boolean);

        if (containerNames.length === 0) {
          this.log(colors.textMuted(`  ${agentName}: No container found, skipping`));
          continue;
        }

        for (const containerName of containerNames) {
          this.log(colors.textSecondary(`  ${agentName}: Stopping container ${containerName}...`));
          await execAsync(`docker stop ${containerName}`);

          this.log(colors.textSecondary(`  ${agentName}: Removing container ${containerName}...`));
          await execAsync(`docker rm ${containerName}`);
        }

        this.log(colors.success(`  ${agentName}: ✓ Container restarted (will rebuild on next spawn)`));
      } catch (error) {
        this.log(colors.error(`  ${agentName}: ✗ Failed to restart: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    this.log('');
    this.log(colors.primary('✨ Restart complete!'));
    this.log(colors.textMuted('Containers will rebuild with updated configuration on next `prlt work start`'));
  }
}
