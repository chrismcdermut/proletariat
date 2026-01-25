import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  getWorkspaceInfo,
  getAllAgentsStatus,
  getAgentTmuxSessions
} from '../../lib/agents/commands.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class List extends Command {
  static description = 'List all agents and their current status';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type staff',
    '<%= config.bin %> <%= command.id %> --type temp',
  ];

  static flags = {
    type: Flags.string({
      char: 't',
      description: 'Filter by agent type',
      options: ['staff', 'temp', 'all'],
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    try {
      const { flags } = await this.parse(List);
      const jsonMode = shouldOutputJson(flags);

      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      // Filter to active agents only
      const activeAgents = workspaceInfo.agents.filter(a => a.status === 'active');

      // Determine type filter - prompt if not provided
      let typeFilter = flags.type as 'staff' | 'temp' | 'all' | undefined;

      if (!typeFilter) {
        // In JSON mode, output type selection prompt
        if (jsonMode) {
          outputPromptAsJson(
            {
              type: 'list',
              name: 'type',
              message: 'Which agents do you want to list?',
              choices: [
                { name: 'All agents', value: 'all', command: 'prlt agent list --type all --json' },
                { name: 'Staff agents only', value: 'staff', command: 'prlt agent list --type staff --json' },
                { name: 'Temp agents only', value: 'temp', command: 'prlt agent list --type temp --json' },
              ],
            },
            createMetadata('agent list', flags)
          );
          return;
        }

        // Interactive mode - prompt for type
        const { selectedType } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedType',
          message: 'Which agents do you want to list?',
          choices: [
            { name: '📋 All agents', value: 'all' },
            { name: '👔 Staff agents only', value: 'staff' },
            { name: '⏱️  Temp agents only', value: 'temp' },
          ],
        }]);
        typeFilter = selectedType;
      }

      // Filter agents based on type selection
      const staffAgents = activeAgents.filter(a => a.type === 'persistent');
      const tempAgents = activeAgents.filter(a => a.type === 'ephemeral');

      const showStaff = typeFilter === 'all' || typeFilter === 'staff';
      const showTemp = typeFilter === 'all' || typeFilter === 'temp';

      const filteredAgents = [
        ...(showStaff ? staffAgents : []),
        ...(showTemp ? tempAgents : []),
      ];

      if (filteredAgents.length === 0) {
        const typeLabel = typeFilter === 'all' ? '' : ` ${typeFilter}`;
        this.log(chalk.yellow(`No active${typeLabel} agents found.`));
        this.log(chalk.dim('Use "prlt agent staff add" or "prlt work spawn" to create agents.'));
        return;
      }

      // Get status for all active agents
      const agentsStatus = getAllAgentsStatus(workspaceInfo);

      // Staff agents section
      if (showStaff && staffAgents.length > 0) {
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
      if (showTemp && tempAgents.length > 0) {
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

      // Calculate tickets for filtered agents only
      const filteredAgentNames = new Set(filteredAgents.map(a => a.name));
      const filteredStatus = agentsStatus.filter(a => filteredAgentNames.has(a.name));
      const totalAssignedTickets = filteredStatus.reduce((sum, a) => sum + a.assignedTickets.length, 0);

      this.log(chalk.bold(`Summary:`));
      if (showStaff) {
        this.log(`   Staff agents: ${staffAgents.length} (${activeStaffCount} active)`);
      }
      if (showTemp) {
        this.log(`   Temp agents: ${tempAgents.length} (${activeTempCount} active${runningTempCount > 0 ? `, ${runningTempCount} running` : ''})`);
      }

      if (workspaceInfo.hasPMO) {
        this.log(`   Tickets assigned: ${totalAssignedTickets}`);
      }

      // Show cleaned agents count if any (only when showing all)
      if (typeFilter === 'all') {
        const cleanedAgents = workspaceInfo.agents.filter(a => a.status === 'cleaned');
        if (cleanedAgents.length > 0) {
          this.log(chalk.dim(`   Cleaned (historical): ${cleanedAgents.length}`));
        }
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
