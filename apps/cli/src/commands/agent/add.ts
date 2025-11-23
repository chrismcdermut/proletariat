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

export default class Add extends Command {
  static description = 'Add new agents to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> alice bob',
    '<%= config.bin %> <%= command.id %> --interactive',
  ];

  static args = {
    agents: Args.string({
      description: 'Agent names to add (space-separated)',
      required: false,
    }),
  };

  static flags = {};

  static strict = false; // Allow multiple agent names

  async run(): Promise<void> {
    const { argv } = await this.parse(Add);
    
    // Find HQ root
    const hqRoot = this.findHQRoot();
    if (!hqRoot) {
      this.error('Not in an HQ directory. Run "prlt init hq" first.');
    }

    const configPath = path.join(hqRoot, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as HQConfig;

    let agentNames = argv as string[];

    // Interactive mode if no agents specified
    if (agentNames.length === 0) {
      const { inputMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'inputMethod',
          message: 'How would you like to add agents?',
          choices: [
            { name: 'Enter agent names manually', value: 'manual' },
            { name: 'Select from predefined list', value: 'list' }
          ]
        }
      ]);

      if (inputMethod === 'manual') {
        const { names } = await inquirer.prompt([
          {
            type: 'input',
            name: 'names',
            message: 'Enter agent names (space-separated):',
            validate: (input: string) => input.trim().length > 0 || 'Please enter at least one name'
          }
        ]);
        agentNames = names.split(/\s+/).filter((n: string) => n.length > 0);
      } else {
        // Provide some suggested agent names
        const suggestedNames = ['alice', 'bob', 'charlie', 'diana', 'eve', 'frank', 'grace', 'henry'];
        const availableNames = suggestedNames.filter(name => !config.agents.includes(name));

        if (availableNames.length === 0) {
          this.log(chalk.yellow('All suggested agents are already added.'));
          const { names } = await inquirer.prompt([
            {
              type: 'input',
              name: 'names',
              message: 'Enter custom agent names (space-separated):',
              validate: (input: string) => input.trim().length > 0 || 'Please enter at least one name'
            }
          ]);
          agentNames = names.split(/\s+/).filter((n: string) => n.length > 0);
        } else {
          const { selected } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selected',
              message: 'Select agents to add:',
              choices: availableNames.map(name => ({ name, value: name })),
              validate: (input) => input.length > 0 || 'Please select at least one agent'
            }
          ]);
          agentNames = selected;
        }
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

    // Create garage directory if it doesn't exist
    const garageDir = path.join(hqRoot, '..', 'garage');
    if (!fs.existsSync(garageDir)) {
      fs.mkdirSync(garageDir, { recursive: true });
    }

    // Add agents
    for (const agent of newAgents) {
      this.log(chalk.blue(`Adding agent: ${agent}...`));
      
      const agentDir = path.join(garageDir, agent);
      
      try {
        // Create git worktree for the agent
        const repoPath = path.dirname(hqRoot);
        execSync(`git worktree add ${agent} -b agent-${agent}`, {
          cwd: garageDir,
          stdio: 'inherit'
        });

        // Create .proletariat config for the agent
        const agentConfigDir = path.join(agentDir, '.proletariat');
        fs.mkdirSync(agentConfigDir, { recursive: true });
        
        const agentConfig = {
          type: 'worktree',
          agentName: agent,
          created: new Date().toISOString(),
          hqPath: path.relative(agentDir, hqRoot)
        };
        
        fs.writeFileSync(
          path.join(agentConfigDir, 'config.json'),
          JSON.stringify(agentConfig, null, 2)
        );

        // Create work.md file for the agent
        const workFile = path.join(agentDir, 'work.md');
        const workContent = `# Agent: ${agent}

## Work Log
Created: ${new Date().toISOString()}

## Current Tasks
- [ ] Awaiting assignment

## Notes

---
`;
        fs.writeFileSync(workFile, workContent);

        this.log(chalk.green(`✅ Agent ${agent} added successfully`));
      } catch (error) {
        this.log(chalk.red(`Failed to add agent ${agent}: ${error}`));
      }
    }

    // Update HQ config
    config.agents.push(...newAgents);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    this.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
    this.log(chalk.gray(`Agents are located in: ${garageDir}`));
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