import { Command, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { 
  getWorkspaceInfo, 
  selectExistingAgentsInteractively,
  removeAgentsFromWorkspace
} from '../../lib/agents/commands.js';

export default class Remove extends Command {
  static description = 'Remove agents from the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry tacoma',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    agents: Args.string({
      description: 'Agent names to remove (space-separated)',
      required: false,
    }),
  };

  static flags = {};

  static strict = false; // Allow multiple agent names

  async run(): Promise<void> {
    const { argv } = await this.parse(Remove);
    
    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();
      
      if (workspaceInfo.agents.length === 0) {
        this.log(colors.warning('No agents to remove.'));
        return;
      }

      let agentNames = argv as string[];

      // Interactive mode if no agents specified
      if (agentNames.length === 0) {
        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select agents to remove (or press Enter to cancel):',
          choices: workspaceInfo.agents.map(agent => ({ name: agent.name, value: agent.name }))
        }]);
        
        if (selected.length === 0) {
          this.log(colors.textMuted('No agents selected. Operation cancelled.'));
          return;
        }
        
        agentNames = selected;
      }

      // Filter to only existing agents
      const existingAgentNames = workspaceInfo.agents.map(a => a.name);
      const agentsToRemove = agentNames.filter(name => {
        if (!existingAgentNames.includes(name)) {
          this.log(colors.warning(`Agent ${name} not found`));
          return false;
        }
        return true;
      });

      if (agentsToRemove.length === 0) {
        this.log(colors.warning('No valid agents to remove.'));
        return;
      }

      // Confirm removal
      const { confirm } = await inquirer.prompt([
        {
          type: 'list',
          name: 'confirm',
          message: `Are you sure you want to remove ${agentsToRemove.length} agent(s)? This will delete their worktrees.`,
          choices: [
            { name: '❌ No, cancel', value: false },
            { name: '⚠️  Yes, remove agents', value: true }
          ],
          default: 0 // Default to "No, cancel"
        }
      ]);

      if (!confirm) {
        this.log(colors.textMuted('Removal cancelled.'));
        return;
      }

      // Remove agents
      this.log(colors.primary(`Removing ${agentsToRemove.length} agent(s)...`));
      
      const { removed, failed } = await removeAgentsFromWorkspace(workspaceInfo, agentsToRemove);

      // Show results for each agent
      for (const agentName of agentsToRemove) {
        if (removed.includes(agentName)) {
          this.log(format.success(`Agent ${agentName} removed`));
        } else if (failed.includes(agentName)) {
          this.log(format.error(`Failed to remove agent ${agentName}`));
        }
      }

      // Summary
      if (removed.length > 0) {
        this.log(format.success(`\nSuccessfully removed ${removed.length} agent(s): ${removed.join(', ')}`));
      }
      if (failed.length > 0) {
        this.log(format.error(`\nFailed to remove ${failed.length} agent(s): ${failed.join(', ')}`));
      }
      
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}