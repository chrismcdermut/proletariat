import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  getWorkspaceInfo,
  getAllAgentsStatus
} from '../../../lib/agents/commands.js';

export default class List extends Command {
  static description = 'List all staff (persistent) agents and their status';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {};

  async run(): Promise<void> {
    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      // Filter to staff agents only
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');

      if (staffAgents.length === 0) {
        this.log(chalk.yellow('No staff agents found. Add staff agents with "prlt agent staff add"'));
        return;
      }

      // Get status for all agents and filter to staff
      const agentsStatus = getAllAgentsStatus(workspaceInfo);
      const staffStatus = agentsStatus.filter(a =>
        staffAgents.some(s => s.name === a.name)
      );

      this.log(chalk.bold.cyan('\n Staff Agents:\n'));

      for (const agentStatus of staffStatus) {
        // Agent info line
        const statusIcon = agentStatus.exists ? '🟢' : '🔴';
        const status = agentStatus.exists ? chalk.green('Active') : chalk.red('Missing');

        this.log(`${statusIcon} ${chalk.bold(agentStatus.name)} - ${status}`);

        if (agentStatus.exists) {
          // Show branch info
          if (agentStatus.branch) {
            this.log(chalk.cyan(`   Branch: ${agentStatus.branch}`));
          }

          // Show repository status
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

          // Show ticket info
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
            this.log(chalk.yellow('   Agent directory exists but worktrees are missing or corrupted'));
          } else {
            this.log(chalk.red(`   Agent directory not found`));
          }
          this.log(chalk.white('   Run "prlt agent staff add" to recreate'));
        }

        this.log(''); // Empty line between agents
      }

      // Summary
      const activeCount = staffStatus.filter(a => a.exists).length;
      const totalAssignedTickets = staffStatus.reduce((sum, a) => sum + a.assignedTickets.length, 0);

      this.log(chalk.bold(`Summary:`));
      this.log(`   Total staff agents: ${staffAgents.length}`);
      this.log(`   Active: ${activeCount}`);
      this.log(`   Inactive: ${staffAgents.length - activeCount}`);

      if (workspaceInfo.hasPMO) {
        this.log(`   Tickets assigned: ${totalAssignedTickets}`);
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
