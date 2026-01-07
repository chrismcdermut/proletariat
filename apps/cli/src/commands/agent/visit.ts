import { Command, Args } from '@oclif/core';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';

export default class Visit extends Command {
  static description = 'Navigate to agent directory';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to visit',
      required: false,
    }),
  };

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Visit);
    
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
            message: 'Select agent to visit:',
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

      // Calculate path to agent directory
      const agentDir = path.join(workspaceInfo.agentsPath, agentName!);
      const relativePath = path.relative(process.cwd(), agentDir);

      // Display navigation command
      this.log(colors.primary(`🤖 Visiting agent: ${agentName}`));
      this.log(colors.command(`cd ${relativePath}`));
      this.log('');
      this.log(colors.textSecondary('Note: Due to shell limitations, you need to run this command manually.'));
      
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}