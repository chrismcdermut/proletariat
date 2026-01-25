import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { isDockerRunning } from '../../lib/execution/runners.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
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

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('agent login', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Check Docker is running
    if (!isDockerRunning()) {
      return handleError('DOCKER_NOT_RUNNING', 'Docker is not running. Please start Docker Desktop and try again.');
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

    // Interactive mode if no agent specified
    if (!agentName) {
      // In JSON mode, output agent selection prompt
      if (jsonMode) {
        const agentChoices = workspaceInfo.agents.map((agent) => ({ name: agent.name, value: agent.name }));
        outputPromptAsJson(
          buildPromptConfig('list', 'name', 'Select agent to authenticate:', agentChoices),
          createMetadata('agent login', flags)
        );
        return;
      }

      // Group agents by type
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];

      if (staffAgents.length > 0) {
        choices.push(new inquirer.Separator('── Staff Agents ──'));
        for (const agent of staffAgents) {
          choices.push({ name: `👔 ${agent.name}`, value: agent.name });
        }
      }

      if (tempAgents.length > 0) {
        choices.push(new inquirer.Separator('── Temp Agents ──'));
        for (const agent of tempAgents) {
          choices.push({ name: `⏱️  ${agent.name}`, value: agent.name });
        }
      }

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent to authenticate:',
          choices
        }
      ]);
      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`);
    }

    const agentDir = path.join(workspaceInfo.agentsPath, agentName!);

    // Check if devcontainer exists
    const devcontainerPath = path.join(agentDir, '.devcontainer');
    try {
      execSync(`test -d "${devcontainerPath}"`, { stdio: 'ignore' });
    } catch {
      this.error(`Agent "${agentName}" does not have a devcontainer configuration. Run "prlt agent add ${agentName}" to initialize.`);
    }

    // Get container ID
    this.log(colors.primary(`🔐 Authenticating agent: ${agentName}`));
    this.log('');

    let containerId: string;
    try {
      containerId = execSync(
        `docker ps --filter "label=devcontainer.local_folder=${agentDir}" --format "{{.ID}}"`,
        { encoding: 'utf-8' }
      ).trim();
    } catch {
      this.error('Failed to find running container. Make sure the agent container is running.');
    }

    if (!containerId) {
      this.log(colors.warning('Container is not running. Starting it now...'));
      this.log('');

      try {
        execSync(`devcontainer up --workspace-folder "${agentDir}"`, {
          stdio: 'inherit',
          cwd: agentDir
        });

        // Get container ID again
        containerId = execSync(
          `docker ps --filter "label=devcontainer.local_folder=${agentDir}" --format "{{.ID}}"`,
          { encoding: 'utf-8' }
        ).trim();
      } catch {
        this.error('Failed to start container.');
      }
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
