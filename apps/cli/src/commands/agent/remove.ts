import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface HQConfig {
  type: 'hq';
  created: string;
  agents: string[];
  repos: string[];
  theme: string;
  mode: 'single-repo' | 'multi-repo';
}

export default class Remove extends Command {
  static description = 'Remove agents from the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> alice bob',
    '<%= config.bin %> <%= command.id %> --interactive',
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
    
    // Find HQ root
    const hqRoot = this.findHQRoot();
    if (!hqRoot) {
      this.error('Not in an HQ directory. Run "prlt init hq" first.');
    }

    const configPath = path.join(hqRoot, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as HQConfig;

    if (config.agents.length === 0) {
      this.log(chalk.yellow('No agents to remove.'));
      return;
    }

    let agentNames = argv as string[];

    // Interactive mode if no agents specified
    if (agentNames.length === 0) {
      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: 'Select agents to remove:',
          choices: config.agents.map(name => ({ name, value: name })),
          validate: (input) => input.length > 0 || 'Please select at least one agent'
        }
      ]);
      agentNames = selected;
    }

    // Filter to only existing agents
    const agentsToRemove = agentNames.filter(name => {
      if (!config.agents.includes(name)) {
        this.log(chalk.yellow(`Agent ${name} not found`));
        return false;
      }
      return true;
    });

    if (agentsToRemove.length === 0) {
      this.log(chalk.yellow('No valid agents to remove.'));
      return;
    }

    // Confirm removal
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to remove ${agentsToRemove.length} agent(s)? This will delete their worktrees.`,
        default: false
      }
    ]);

    if (!confirm) {
      this.log(chalk.gray('Removal cancelled.'));
      return;
    }

    const garageDir = path.join(hqRoot, '..', 'garage');
    const removedAgents: string[] = [];
    const failedAgents: string[] = [];

    // Remove agents
    for (const agent of agentsToRemove) {
      this.log(chalk.blue(`Removing agent: ${agent}...`));
      
      const agentDir = path.join(garageDir, agent);
      
      try {
        if (fs.existsSync(agentDir)) {
          // Remove git worktree
          try {
            execSync(`git worktree remove ${agent} --force`, {
              cwd: garageDir,
              stdio: 'pipe'
            });
          } catch (error) {
            // If git worktree remove fails, try manual removal
            this.log(chalk.yellow(`Git worktree remove failed, attempting manual cleanup...`));
            
            // Remove directory manually
            fs.rmSync(agentDir, { recursive: true, force: true });
            
            // Clean up git worktree list
            try {
              execSync(`git worktree prune`, {
                cwd: hqRoot,
                stdio: 'pipe'
              });
            } catch {
              // Ignore prune errors
            }
          }
        }
        
        removedAgents.push(agent);
        this.log(chalk.green(`✅ Agent ${agent} removed`));
      } catch (error) {
        failedAgents.push(agent);
        this.log(chalk.red(`❌ Failed to remove agent ${agent}: ${error}`));
      }
    }

    // Update config - remove successfully removed agents
    if (removedAgents.length > 0) {
      config.agents = config.agents.filter(agent => !removedAgents.includes(agent));
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    // Summary
    if (removedAgents.length > 0) {
      this.log(chalk.green(`\n✅ Successfully removed ${removedAgents.length} agent(s)`));
    }
    if (failedAgents.length > 0) {
      this.log(chalk.red(`\n❌ Failed to remove ${failedAgents.length} agent(s): ${failedAgents.join(', ')}`));
    }
  }

  private findHQRoot(): string | null {
    let currentDir = process.cwd();
    
    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          return currentDir;
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }
}