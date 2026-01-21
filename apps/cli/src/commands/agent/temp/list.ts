import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  getWorkspaceInfo,
  getAllAgentsStatus,
  getAgentTmuxSessions
} from '../../../lib/agents/commands.js';

export default class List extends Command {
  static description = 'List all temporary (ephemeral) agents and their status';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {};

  async run(): Promise<void> {
    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      // Filter to ephemeral agents only
      const ephemeralAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      if (ephemeralAgents.length === 0) {
        this.log(chalk.yellow('No temporary agents found. Create them with "prlt work spawn"'));
        return;
      }

      // Separate active and cleaned agents
      const activeAgents = ephemeralAgents.filter(a => a.status === 'active');
      const cleanedAgents = ephemeralAgents.filter(a => a.status === 'cleaned');

      // Get status for all agents
      const agentsStatus = getAllAgentsStatus(workspaceInfo);

      // Active agents
      if (activeAgents.length > 0) {
        this.log(chalk.bold.cyan('\n Active Temporary Agents:\n'));

        const activeStatus = agentsStatus.filter(a =>
          activeAgents.some(s => s.name === a.name)
        );

        for (const agentStatus of activeStatus) {
          // Check for running tmux sessions
          const sessions = getAgentTmuxSessions(agentStatus.name);
          const hasRunningWork = sessions.length > 0;

          // Agent info line
          const statusIcon = hasRunningWork ? '🟡' : (agentStatus.exists ? '🟢' : '🔴');
          const runningLabel = hasRunningWork ? chalk.yellow(' (running)') : '';
          const status = agentStatus.exists ? chalk.green('Active') : chalk.red('Missing');

          this.log(`${statusIcon} ${chalk.bold(agentStatus.name)} - ${status}${runningLabel}`);

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
            }
          } else {
            const agentDir = path.join(workspaceInfo.agentsPath, agentStatus.name);
            const dirExists = fs.existsSync(agentDir);

            if (dirExists) {
              this.log(chalk.red(`   Invalid or broken worktrees`));
            } else {
              this.log(chalk.red(`   Agent directory not found`));
            }
          }

          this.log(''); // Empty line between agents
        }
      }

      // Cleaned agents (if any)
      if (cleanedAgents.length > 0) {
        this.log(chalk.bold.dim('\n Cleaned Temporary Agents:\n'));

        for (const agent of cleanedAgents) {
          const cleanedAt = agent.cleaned_at
            ? new Date(agent.cleaned_at).toLocaleString()
            : 'unknown';
          this.log(chalk.dim(`   ${agent.name} - cleaned at ${cleanedAt}`));
        }
        this.log('');
      }

      // Summary
      const runningCount = activeAgents.filter(a => {
        const sessions = getAgentTmuxSessions(a.name);
        return sessions.length > 0;
      }).length;

      this.log(chalk.bold(`Summary:`));
      this.log(`   Total temporary agents: ${ephemeralAgents.length}`);
      this.log(`   Active: ${activeAgents.length}`);
      if (runningCount > 0) {
        this.log(chalk.yellow(`   Running work: ${runningCount}`));
      }
      this.log(chalk.dim(`   Cleaned: ${cleanedAgents.length}`));

      if (activeAgents.length > 0 && runningCount === 0) {
        this.log(chalk.dim('\nTip: Use "prlt agent temp cleanup --temp" to clean up idle agents.'));
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
