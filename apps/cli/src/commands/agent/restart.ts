import { Args, Flags } from '@oclif/core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { colors } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { isDockerRunning } from '../../lib/execution/runners.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

const execAsync = promisify(exec);

export default class AgentRestart extends PMOCommand {
  static description = 'Restart a specific agent devcontainer';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
    '<%= config.bin %> <%= command.id %> --json  # JSON mode for AI agents',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to restart',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(AgentRestart);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Check Docker is running
    if (!isDockerRunning()) {
      if (jsonMode) {
        outputErrorAsJson('DOCKER_NOT_RUNNING', 'Docker is not running. Please start Docker Desktop and try again.', createMetadata('agent restart', flags));
        this.exit(1);
      }
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    let agentName = args.name;

    // If no agent name provided, prompt for selection
    if (!agentName) {
      const agents = this.getAvailableAgents();

      if (agents.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_AGENTS', 'No agents found.', createMetadata('agent restart', flags));
          return;
        }
        this.log(colors.warning('No agents found.'));
        return;
      }

      const selected = await this.selectFromList({
        message: 'Select agent to restart:',
        items: agents,
        getName: (a) => a.name,
        getValue: (a) => a.name,
        getCommand: (a) => `prlt agent restart ${a.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'agent restart' } : null,
      });

      if (!selected) {
        return;
      }
      agentName = selected;
    }

    this.log(colors.primary(`🔄 Restarting agent: ${agentName}\n`));

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
      // eslint-disable-next-line no-await-in-loop -- Sequential container operations with user feedback
      await execAsync(`docker stop ${containerName}`);

      this.log(colors.textSecondary(`  Removing container: ${containerName}...`));
      // eslint-disable-next-line no-await-in-loop
      await execAsync(`docker rm ${containerName}`);
    }

    this.log('');
    this.log(colors.success(`✓ Agent ${agentName} container restarted`));
    this.log(colors.textMuted('Container will rebuild with updated configuration on next `prlt work start`'));
  }

  private getAvailableAgents(): Array<{ name: string; type: 'staff' | 'temp' }> {
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      return [];
    }

    const agents: Array<{ name: string; type: 'staff' | 'temp' }> = [];
    const agentsPath = path.join(workspaceInfo.path, 'agents');

    // Check staff agents
    const staffPath = path.join(agentsPath, 'staff');
    if (fs.existsSync(staffPath)) {
      const staffAgents = fs.readdirSync(staffPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => ({ name: d.name, type: 'staff' as const }));
      agents.push(...staffAgents);
    }

    // Check temp agents
    const tempPath = path.join(agentsPath, 'temp');
    if (fs.existsSync(tempPath)) {
      const tempAgents = fs.readdirSync(tempPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => ({ name: d.name, type: 'temp' as const }));
      agents.push(...tempAgents);
    }

    return agents;
  }
}
