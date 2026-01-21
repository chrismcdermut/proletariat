import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  getWorkspaceInfo,
  getAllAgentsStatus,
  getAgentTmuxSessions
} from '../../lib/agents/commands.js';

export default class List extends Command {
  static description = 'List all agents and their current status';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {};

  async run(): Promise<void> {
    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      // Filter to active agents only
      const activeAgents = workspaceInfo.agents.filter(a => a.status === 'active');

      if (activeAgents.length === 0) {
        this.log(chalk.yellow('No active agents found.'));
        this.log(chalk.dim('Use "prlt agent staff add" or "prlt work spawn" to create agents.'));
        return;
      }

      // Get status for all active agents
      const agentsStatus = getAllAgentsStatus(workspaceInfo);

      // Separate by type
      const staffAgents = activeAgents.filter(a => a.type === 'persistent');
      const tempAgents = activeAgents.filter(a => a.type === 'ephemeral');

      // Staff agents section
      if (staffAgents.length > 0) {
        this.log(chalk.bold.cyan('\n Staff Agents:\n'));

        const staffStatus = agentsStatus.filter(a =>
          staffAgents.some(s => s.name === a.name)
        );

        for (const agentStatus of staffStatus) {
          const statusIcon = agentStatus.exists ? '🟢' : '🔴';
          const status = agentStatus.exists ? chalk.green('Active') : chalk.red('Missing');

          this.log(`${statusIcon} ${chalk.bold(agentStatus.name)} ${chalk.dim('[staff]')} - ${status}`);

          if (agentStatus.exists) {
            if (agentStatus.branch) {
              this.log(chalk.cyan(`   Branch: ${agentStatus.branch}`));
            }

            if (agentStatus.repositories.length > 0) {
              const dirtyRepos = agentStatus.repositories.filter(r => r.status === 'dirty').length;
              const reposWithCommits = agentStatus.repositories.filter(r => r.commitsAhead > 0);

              let repoStatusText = `${agentStatus.repositories.length} repo(s)`;
              if (dirtyRepos > 0) {
                repoStatusText += `, ${dirtyRepos} dirty`;
              }
              if (reposWithCommits.length > 0) {
                const commitDetails = reposWithCommits.map(r => `${r.name}(+${r.commitsAhead})`).join(', ');
                repoStatusText += `, commits ahead: ${commitDetails}`;
              }
              this.log(chalk.white(`   Repositories: ${repoStatusText}`));
            }

            if (agentStatus.assignedTickets.length > 0) {
              this.log(chalk.blue(`   Current tickets: ${agentStatus.assignedTickets.join(', ')}`));
            } else {
              this.log(chalk.white('   No active tickets'));
            }

            if (agentStatus.completedTickets.length > 0) {
              this.log(chalk.white(`   Completed: ${agentStatus.completedTickets.length} ticket(s)`));
            }
          } else {
            const agentDir = path.join(workspaceInfo.agentsPath, agentStatus.name);
            const dirExists = fs.existsSync(agentDir);

            if (dirExists) {
              this.log(chalk.red(`   Invalid or broken worktrees`));
            } else {
              this.log(chalk.red(`   Agent directory not found`));
            }
            this.log(chalk.white('   Run "prlt agent staff add" to recreate'));
          }

          this.log('');
        }
      }

      // Temp agents section
      if (tempAgents.length > 0) {
        this.log(chalk.bold.yellow('\n Temporary Agents:\n'));

        const tempStatus = agentsStatus.filter(a =>
          tempAgents.some(s => s.name === a.name)
        );

        for (const agentStatus of tempStatus) {
          const sessions = getAgentTmuxSessions(agentStatus.name);
          const hasRunningWork = sessions.length > 0;

          const statusIcon = hasRunningWork ? '🟡' : (agentStatus.exists ? '🟢' : '🔴');
          const runningLabel = hasRunningWork ? chalk.yellow(' (running)') : '';
          const status = agentStatus.exists ? chalk.green('Active') : chalk.red('Missing');

          this.log(`${statusIcon} ${chalk.bold(agentStatus.name)} ${chalk.dim('[temp]')} - ${status}${runningLabel}`);

          if (agentStatus.exists) {
            if (agentStatus.branch) {
              this.log(chalk.cyan(`   Branch: ${agentStatus.branch}`));
            }

            if (agentStatus.assignedTickets.length > 0) {
              this.log(chalk.blue(`   Current tickets: ${agentStatus.assignedTickets.join(', ')}`));
            }
          } else {
            this.log(chalk.red(`   Agent directory not found`));
          }

          this.log('');
        }
      }

      // Summary
      const activeStaffCount = agentsStatus.filter(a =>
        staffAgents.some(s => s.name === a.name) && a.exists
      ).length;
      const activeTempCount = agentsStatus.filter(a =>
        tempAgents.some(s => s.name === a.name) && a.exists
      ).length;
      const runningTempCount = tempAgents.filter(a => {
        const sessions = getAgentTmuxSessions(a.name);
        return sessions.length > 0;
      }).length;
      const totalAssignedTickets = agentsStatus.reduce((sum, a) => sum + a.assignedTickets.length, 0);

      this.log(chalk.bold(`Summary:`));
      this.log(`   Staff agents: ${staffAgents.length} (${activeStaffCount} active)`);
      this.log(`   Temp agents: ${tempAgents.length} (${activeTempCount} active${runningTempCount > 0 ? `, ${runningTempCount} running` : ''})`);

      if (workspaceInfo.hasPMO) {
        this.log(`   Tickets assigned: ${totalAssignedTickets}`);
      }

      // Show cleaned agents count if any
      const cleanedAgents = workspaceInfo.agents.filter(a => a.status === 'cleaned');
      if (cleanedAgents.length > 0) {
        this.log(chalk.dim(`   Cleaned (historical): ${cleanedAgents.length}`));
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
