import { Command, Args } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';

export default class Login extends Command {
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

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Login);

    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      if (workspaceInfo.agents.length === 0) {
        this.log(colors.warning('No agents found. Add agents with "prlt agent add"'));
        return;
      }

      let agentName = args.name;

      // Interactive mode if no agent specified
      if (!agentName) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select agent to authenticate:',
            choices: workspaceInfo.agents.map(agent => ({
              name: agent.name,
              value: agent.name
            }))
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
      } catch (error) {
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
        } catch (error) {
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

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
