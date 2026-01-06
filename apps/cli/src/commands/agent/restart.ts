import { Args } from '@oclif/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import { colors } from '../../lib/colors.js';
import { DockerCommand } from '../../lib/commands/docker-command.js';

const execAsync = promisify(exec);

export default class AgentRestart extends DockerCommand {
  static description = 'Restart a specific agent devcontainer';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to restart',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AgentRestart);
    const agentName = args.name;

    this.log(colors.primary(`🔄 Restarting agent: ${agentName}\n`));

    try {
      // Find container by agent name
      const { stdout: containers } = await execAsync(`docker ps -a --format "{{.Names}}" | grep -i "${agentName}" || true`);

      const containerNames = containers.trim().split('\n').filter(Boolean);

      if (containerNames.length === 0) {
        this.log(colors.warning(`No container found for agent: ${agentName}`));
        this.log(colors.textMuted('The container will be created on next `prlt work start`'));
        return;
      }

      for (const containerName of containerNames) {
        this.log(colors.textSecondary(`  Stopping container: ${containerName}...`));
        await execAsync(`docker stop ${containerName}`);

        this.log(colors.textSecondary(`  Removing container: ${containerName}...`));
        await execAsync(`docker rm ${containerName}`);
      }

      this.log('');
      this.log(colors.success(`✓ Agent ${agentName} container restarted`));
      this.log(colors.textMuted('Container will rebuild with updated configuration on next `prlt work start`'));
    } catch (error) {
      this.error(`Failed to restart agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
