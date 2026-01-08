import { Args } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  getWorkspaceInfo,
  getAgentStatus
} from '../../lib/agents/commands.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';

export default class Status extends PMOCommand {
  static description = 'Show detailed status for a specific agent';

  static examples = [
    '<%= config.bin %> <%= command.id %> agent-1',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name for detailed status',
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
    const { args } = await this.parse(Status);

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      this.log(colors.warning('No agents found. Add agents with "prlt agents add"'));
      return;
    }

    let agentName = args.name;

    // Interactive mode if no agent specified
    if (!agentName) {
      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select agent to view status:',
          choices: workspaceInfo.agents.map((agent: any) => ({
            name: agent.name,
            value: agent.name
          }))
        }
      ]);
      agentName = selected;
    }

    await this.showDetailedStatus(workspaceInfo, agentName!);
  }

  private async showDetailedStatus(workspaceInfo: any, agentName: string): Promise<void> {
    // Validate agent exists
    const agent = workspaceInfo.agents.find((a: any) => a.name === agentName);
    if (!agent) {
      this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map((a: any) => a.name).join(', ')}`);
    }

    const agentStatus = getAgentStatus(workspaceInfo, agentName);

    this.log(format.title(`🤖 Agent: ${agentName}`));

    // Basic status
    const statusIcon = agentStatus.exists ? '🟢' : '🔴';
    const status = agentStatus.exists ? colors.active('Active') : colors.inactive('Missing');
    this.log(`${statusIcon} Status: ${status}`);

    if (!agentStatus.exists) {
      this.log(colors.error('   Agent directory not found'));
      this.log(colors.textSecondary('   Run "prlt agents add" to recreate'));
      return;
    }

    // Location
    this.log(`📍 Location: ${colors.path(`${workspaceInfo.agentsPath}/${agentName}`)}`);

    // Branch info
    if (agentStatus.branch) {
      this.log(`🌿 Branch: ${colors.warning(agentStatus.branch)}`);
    }

    // Repository status
    this.log(format.subtitle('\n📁 Repositories:'));
    if (agentStatus.repositories.length === 0) {
      this.log(colors.textMuted('   No repositories configured'));
    } else {
      for (const repo of agentStatus.repositories) {
        let statusText = '';
        let statusColor = colors.textMuted;

        switch (repo.status) {
          case 'clean':
            statusText = 'clean';
            statusColor = colors.repoClean;
            break;
          case 'dirty':
            statusText = 'dirty';
            statusColor = colors.repoDirty;
            break;
          case 'missing':
            statusText = 'missing';
            statusColor = colors.repoMissing;
            break;
          default:
            statusText = repo.status;
            statusColor = colors.textMuted;
        }

        let repoLine = `   • ${colors.text(repo.name)} (${statusColor(statusText)})`;
        if (repo.commitsAhead > 0) {
          repoLine += colors.commitsAhead(` ${repo.commitsAhead} commits ahead`);
        }

        this.log(repoLine);
      }
    }

    // Ticket assignments
    if (workspaceInfo.hasPMO) {
      this.log(format.subtitle('\n🎫 Tickets:'));
      if (agentStatus.assignedTickets.length === 0 && agentStatus.completedTickets.length === 0) {
        this.log(colors.textSecondary('   No tickets assigned'));
      } else {
        if (agentStatus.assignedTickets.length > 0) {
          this.log(`   Active: ${colors.primary(agentStatus.assignedTickets.join(', '))}`);
        }
        if (agentStatus.completedTickets.length > 0) {
          this.log(`   Completed: ${colors.textMuted(agentStatus.completedTickets.length + ' ticket(s)')}`);
        }
      }
    }
  }
}