import { Args } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  getWorkspaceInfo,
  removeAgentsFromWorkspace
} from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';

export default class Remove extends PMOCommand {
  static description = 'Remove a specific agent from the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to remove',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(Remove);

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      this.log(colors.warning('No agents to remove.'));
      return;
    }

    let agentName = args.name;

    // Interactive mode if no agent specified
    if (!agentName) {
      const choices = [
        ...workspaceInfo.agents.map((agent: any) => ({
          name: agent.name,
          value: agent.name
        })),
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ];

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent to remove:',
          choices
        }
      ]);

      if (selected === 'cancel') {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find((a: any) => a.name === agentName);
    if (!agent) {
      this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map((a: any) => a.name).join(', ')}`);
    }

    const agentsToRemove = [agentName!];

    // Confirm removal
    const { confirm } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirm',
        message: `Are you sure you want to remove agent "${agentName!}"? This will delete its worktree.`,
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '⚠️  Yes, remove agent', value: true }
        ],
        default: 0 // Default to "No, cancel"
      }
    ]);

    if (!confirm) {
      this.log(colors.textMuted('Removal cancelled.'));
      return;
    }

    // Remove agents
    this.log(colors.primary(`Removing agent "${agentName!}"...`));

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
  }
}