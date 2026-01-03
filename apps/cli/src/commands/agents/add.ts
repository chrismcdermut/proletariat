import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  getWorkspaceInfo,
  selectAgentsInteractively,
  validateAgentNames,
  addAgentsToWorkspace
} from '../../lib/agents/commands.js';

export default class Add extends Command {
  static description = 'Add new agents to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> agent-1 agent-2',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> my-agent --no-container',
  ];

  static args = {
    names: Args.string({
      description: 'Agent names to add (space-separated)',
      required: false,
    }),
  };

  static flags = {
    'no-container': Flags.boolean({
      description: 'Skip devcontainer setup (not recommended for autonomous agents)',
      default: false,
    }),
  };

  static strict = false; // Allow multiple agent names

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Add);

    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      let agentNames = argv as string[];

      // Interactive mode if no agents specified
      if (agentNames.length === 0) {
        try {
          agentNames = await selectAgentsInteractively(workspaceInfo, 'Enter agent names to add');
          if (agentNames.length === 0) {
            this.log(chalk.yellow('No agents specified.'));
            return;
          }
        } catch (error) {
          this.error(error instanceof Error ? error.message : String(error));
        }
      }

      // Validate agent names
      const { valid, invalid } = validateAgentNames(agentNames);

      if (invalid.length > 0) {
        this.log(chalk.red(`Invalid agent names: ${invalid.join(', ')}`));
        this.log(chalk.yellow('Agent names must be lowercase alphanumeric with optional hyphens/underscores.'));
        if (valid.length === 0) {
          return;
        }
        this.log(chalk.blue(`Proceeding with valid agents: ${valid.join(', ')}`));
      }

      // Add agents to workspace
      const addedAgents = await addAgentsToWorkspace(workspaceInfo, valid, {
        skipDevcontainer: flags['no-container'],
      });

      if (addedAgents.length === 0) {
        this.log(chalk.yellow('No new agents to add. All specified agents already exist.'));
        return;
      }

      this.log(chalk.green(`\n🎉 Successfully added ${addedAgents.length} agent(s): ${addedAgents.join(', ')}`));

      if (!flags['no-container']) {
        this.log(chalk.blue('   Devcontainer config created for sandboxed execution'));
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}