import { Command } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface HQConfig {
  type: 'hq';
  created: string;
  agents: string[];
  repos: string[];
  theme: string;
  mode: 'single-repo' | 'multi-repo';
}

interface Ticket {
  id: string;
  title: string;
  assignee?: string;
  status: 'todo' | 'in-progress' | 'done';
  queue: string;
}

export default class List extends Command {
  static description = 'List all agents and their current status';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {};

  async run(): Promise<void> {
    // Find HQ root
    const hqRoot = this.findHQRoot();
    if (!hqRoot) {
      this.error('Not in an HQ directory. Run "prlt init hq" first.');
    }

    const configPath = path.join(hqRoot, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as HQConfig;

    if (config.agents.length === 0) {
      this.log(chalk.yellow('No agents found. Add agents with "prlt agent add"'));
      return;
    }

    // Load tickets to show assignments
    const ticketsFile = path.join(hqRoot, 'pmo', 'tickets.json');
    let tickets: Ticket[] = [];
    if (fs.existsSync(ticketsFile)) {
      tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf-8'));
    }

    this.log(chalk.bold.cyan('\n👥 Active Agents:\n'));
    
    const garageDir = path.join(hqRoot, '..', 'garage');
    
    for (const agent of config.agents) {
      const agentDir = path.join(garageDir, agent);
      const agentExists = fs.existsSync(agentDir);
      
      // Find assigned tickets
      const assignedTickets = tickets.filter(t => t.assignee === agent && t.status !== 'done');
      const completedTickets = tickets.filter(t => t.assignee === agent && t.status === 'done');
      
      // Agent info line
      const statusIcon = agentExists ? '🟢' : '🔴';
      const status = agentExists ? chalk.green('Active') : chalk.red('Missing');
      
      this.log(`${statusIcon} ${chalk.bold(agent)} - ${status}`);
      
      if (agentExists) {
        // Check for current branch
        try {
          const branch = fs.readFileSync(path.join(agentDir, '.git'), 'utf-8')
            .match(/gitdir: (.+)/)?.[1];
          if (branch) {
            const branchName = branch.split('/').pop()?.replace('.git', '');
            this.log(chalk.gray(`   Branch: ${branchName}`));
          }
        } catch {
          // Ignore if we can't read git info
        }
        
        // Show ticket info
        if (assignedTickets.length > 0) {
          this.log(chalk.blue(`   Current tickets: ${assignedTickets.map(t => t.id).join(', ')}`));
          const inProgress = assignedTickets.filter(t => t.status === 'in-progress');
          if (inProgress.length > 0) {
            this.log(chalk.yellow(`   Working on: ${inProgress[0].title}`));
          }
        } else {
          this.log(chalk.gray('   No active tickets'));
        }
        
        if (completedTickets.length > 0) {
          this.log(chalk.gray(`   Completed: ${completedTickets.length} ticket(s)`));
        }
        
        // Check last activity
        const workFile = path.join(agentDir, 'work.md');
        if (fs.existsSync(workFile)) {
          const stats = fs.statSync(workFile);
          const lastModified = new Date(stats.mtime);
          const hoursAgo = Math.floor((Date.now() - lastModified.getTime()) / (1000 * 60 * 60));
          if (hoursAgo < 1) {
            this.log(chalk.green('   Last active: < 1 hour ago'));
          } else if (hoursAgo < 24) {
            this.log(chalk.yellow(`   Last active: ${hoursAgo} hours ago`));
          } else {
            const daysAgo = Math.floor(hoursAgo / 24);
            this.log(chalk.gray(`   Last active: ${daysAgo} day(s) ago`));
          }
        }
      } else {
        this.log(chalk.red(`   Worktree not found at: ${agentDir}`));
        this.log(chalk.gray('   Run "prlt agent add" to recreate'));
      }
      
      this.log(''); // Empty line between agents
    }
    
    // Summary
    const activeCount = config.agents.filter(agent => 
      fs.existsSync(path.join(garageDir, agent))
    ).length;
    
    this.log(chalk.bold(`\n📊 Summary:`));
    this.log(`   Total agents: ${config.agents.length}`);
    this.log(`   Active: ${activeCount}`);
    this.log(`   Inactive: ${config.agents.length - activeCount}`);
    
    if (tickets.length > 0) {
      const assignedCount = tickets.filter(t => t.assignee && t.status !== 'done').length;
      this.log(`   Tickets assigned: ${assignedCount}`);
      this.log(`   Tickets unassigned: ${tickets.filter(t => !t.assignee && t.status !== 'done').length}`);
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