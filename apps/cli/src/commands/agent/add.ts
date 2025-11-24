import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { addAgentsToHQ, selectAgentsFromTheme, findHQRoot } from '../../lib/agents/index.js';
import { THEMES } from '../../lib/themes.js';

export default class Add extends Command {
  static description = 'Add new agents to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> camry tacoma',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    names: Args.string({
      description: 'Agent names to add (space-separated)',
      required: false,
    }),
  };

  static flags = {};

  static strict = false; // Allow multiple agent names

  async run(): Promise<void> {
    const { argv } = await this.parse(Add);
    
    // Find HQ root
    const hqRoot = findHQRoot();
    if (!hqRoot) {
      this.error('Not in an HQ or workspace directory. Run "prlt init" first.');
    }

    const configPath = path.join(hqRoot, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Check if we're in HQ or workspace-only mode
    if (config.type === 'hq') {
      await this.addToHQ(config, hqRoot, argv as string[]);
    } else if (config.type === 'workspace') {
      await this.addToWorkspace(config, hqRoot, argv as string[]);
    } else {
      this.error('Invalid workspace type. Run "prlt init" first.');
    }
  }

  private async addToHQ(config: any, hqPath: string, argNames: string[]): Promise<void> {
    const themeConfig = THEMES[config.theme];
    const workspacePath = path.join(hqPath, 'agents', themeConfig.workspaceDir);

    let agentNames = argNames;

    // Interactive mode if no agents specified
    if (agentNames.length === 0) {
      agentNames = await selectAgentsFromTheme(config.theme, config.agents);
      if (agentNames.length === 0) {
        this.log(chalk.yellow('No agents selected.'));
        return;
      }
    }

    // Use the existing addAgentsToHQ function
    await addAgentsToHQ(hqPath, agentNames, config.theme);
  }

  private async addToWorkspace(config: any, workspacePath: string, argNames: string[]): Promise<void> {
    const themeConfig = THEMES[config.theme];

    let agentNames = argNames;

    // Interactive mode if no agents specified  
    if (agentNames.length === 0) {
      agentNames = await selectAgentsFromTheme(config.theme, config.agents);
      if (agentNames.length === 0) {
        this.log(chalk.yellow('No agents selected.'));
        return;
      }
    }

    // Filter out already existing agents
    const newAgents = agentNames.filter(name => {
      if (config.agents.includes(name)) {
        this.log(chalk.yellow(`Agent ${name} already exists`));
        return false;
      }
      return true;
    });

    if (newAgents.length === 0) {
      this.log(chalk.yellow('No new agents to add.'));
      return;
    }

    // Create agents using the same logic as workspace-only init
    const { createAgentWorktrees } = await import('../../lib/agents/index.js');
    await createAgentWorktrees(workspacePath, newAgents);

    // Update workspace config
    config.agents.push(...newAgents);
    fs.writeFileSync(
      path.join(workspacePath, '.proletariat', 'config.json'),
      JSON.stringify(config, null, 2)
    );

    this.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
  }
}