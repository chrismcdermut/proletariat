import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  isDockerRunning,
  getAgentContainerName,
  isContainerRunning,
  getContainerId,
} from '../../lib/execution/runners.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class Login extends PMOCommand {
  static description = 'Authenticate Claude Code inside an agent container (one-time setup)';

  static examples = [
    '<%= config.bin %> <%= command.id %> damodei',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to authenticate',
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
    const { args, flags } = await this.parse(Login);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Error handling config
    const errorConfig = { jsonMode, commandName: 'agent login', flags };

    // Check Docker is running
    if (!isDockerRunning()) {
      this.handleError('DOCKER_NOT_RUNNING', 'Docker is not running. Please start Docker Desktop and try again.', errorConfig);
    }

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_AGENTS', 'No agents found. Add agents with "prlt agent add"', createMetadata('agent login', flags));
        return;
      }
      this.log(colors.warning('No agents found. Add agents with "prlt agent add"'));
      return;
    }

    let agentName = args.name;

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'agent login' } : null;

    // Interactive mode if no agent specified
    if (!agentName) {
      // Group agents by type
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      // Build choices with command field for JSON mode
      const choices: Array<{ name: string; value: string; command: string }> = [];

      for (const agent of staffAgents) {
        choices.push({ name: `👔 ${agent.name}`, value: agent.name, command: `prlt agent login ${agent.name} --json` });
      }

      for (const agent of tempAgents) {
        choices.push({ name: `⏱️  ${agent.name}`, value: agent.name, command: `prlt agent login ${agent.name} --json` });
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select agent to authenticate:',
        choices,
      }], agentConfig);

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`);
    }

    const agentDir = path.join(workspaceInfo.agentsPath, agentName!);

    // Check if Docker config exists
    const dockerfilePath = path.join(agentDir, '.devcontainer', 'Dockerfile');
    if (!fs.existsSync(dockerfilePath)) {
      this.error(`Agent "${agentName}" does not have a Docker configuration. Run "prlt agent add ${agentName}" to initialize.`);
    }

    // Get container using the standard naming convention
    this.log(colors.primary(`🔐 Authenticating agent: ${agentName}`));
    this.log('');

    const containerName = getAgentContainerName(agentName!);
    let containerId: string | null = null;

    // Check if container is running
    if (isContainerRunning(containerName)) {
      containerId = getContainerId(containerName);
    }

    if (!containerId) {
      this.log(colors.warning('Container is not running.'));
      this.log('');
      this.log('Start the container first by running a work command:');
      this.log('  prlt work start <ticket-id>');
      this.log('');
      this.log('Or start an interactive session:');
      this.log('  prlt agent shell ' + agentName);
      this.error('Container must be running to authenticate.');
    }

    // Create a helper script to launch interactive session
    this.log(colors.success(`✓ Container running: ${containerId}`));
    this.log('');

    // Generate script that opens interactive Claude and prompts for /login
    const scriptPath = `/tmp/prlt-agent-login-${containerId}.sh`;
    const scriptContent = `#!/bin/bash
echo "======================================"
echo "Claude Code Authentication"
echo "======================================"
echo ""
echo "Type: /login"
echo "Then follow the browser prompts to authenticate with your Claude subscription."
echo ""
echo "Your credentials will be saved and persist across container rebuilds."
echo ""
docker exec -it ${containerId} claude
`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    this.log(colors.text('Opening interactive Claude session...'));
    this.log('');

    // Execute the script directly with a new shell
    execSync(`open -a Terminal ${scriptPath}`, { stdio: 'inherit' });

    this.log(colors.success('✓ Opened new terminal window'));
    this.log(colors.textSecondary('Complete the /login flow in the new terminal window.'));
    this.log(colors.textSecondary('Your credentials will be saved automatically.'));
  }
}
