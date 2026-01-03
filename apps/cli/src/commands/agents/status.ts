import { Command, Args } from '@oclif/core';
import { colors, format } from '../../lib/colors.js';
import {
  getWorkspaceInfo,
  getAgentStatus,
  getAllAgentsStatus
} from '../../lib/agents/commands.js';

export default class Status extends Command {
  static description = 'Show detailed status for specific agent or all agents';

  static examples = [
    '<%= config.bin %> <%= command.id %> agent-1',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name for detailed status (optional)',
      required: false,
    }),
  };

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Status);

    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      if (workspaceInfo.agents.length === 0) {
        this.log(colors.warning('No agents found. Add agents with "prlt agents add"'));
        return;
      }

      if (args.name) {
        // Show detailed status for specific agent
        await this.showDetailedStatus(workspaceInfo, args.name);
      } else {
        // Show overview status for all agents
        await this.showOverviewStatus(workspaceInfo);
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
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

  private async showOverviewStatus(workspaceInfo: any): Promise<void> {
    const agentsStatus = getAllAgentsStatus(workspaceInfo);

    this.log(format.title('📊 Agent Status Overview:'));

    for (const agentStatus of agentsStatus) {
      const statusIcon = agentStatus.exists ? '🟢' : '🔴';
      const status = agentStatus.exists ? 'Active' : 'Inactive';
      const statusColor = agentStatus.exists ? colors.active : colors.inactive;

      let statusLine = `${statusIcon} ${colors.agentName(agentStatus.name.padEnd(12))} - ${statusColor(status.padEnd(8))}`;

      if (agentStatus.exists) {
        // Add ticket count
        const ticketCount = agentStatus.assignedTickets.length;
        statusLine += ` - ${ticketCount} ticket${ticketCount !== 1 ? 's' : ''}`;
      }

      this.log(statusLine);
    }

    // Summary
    const activeCount = agentsStatus.filter(a => a.exists).length;
    const totalTickets = agentsStatus.reduce((sum, a) => sum + a.assignedTickets.length, 0);

    this.log(format.subtitle('\nSummary:'));
    this.log(colors.text(`  ${workspaceInfo.agents.length} agents (${activeCount} active, ${workspaceInfo.agents.length - activeCount} inactive)`));

    if (workspaceInfo.hasPMO) {
      this.log(colors.text(`  ${totalTickets} active tickets assigned`));
    }
  }
}