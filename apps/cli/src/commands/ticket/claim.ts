import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import * as React from 'react';
import { render } from 'ink';
import { ClaimTicketUI } from '../../lib/ui/ClaimTicketUI.js';
import { styles } from '../../lib/styles.js';

export default class TicketClaim extends Command {
  static description = 'Claim a ticket (move from backlog to in-progress)';

  static examples = [
    '<%= config.bin %> <%= command.id %> T0001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to claim',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketClaim);
    
    // Find PMO
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Determine agent name (from worktree or prompt)
    let agentName = await this.getAgentName();

    // Pull latest board
    try {
      execSync('git pull', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      // Ignore if no remote
    }

    const boardPath = path.join(pmoPath, 'board.md');
    let board = fs.readFileSync(boardPath, 'utf-8');

    let ticketId = args.ticketId;

    if (!ticketId) {
      // Parse available tickets from backlog
      const backlogSection = board.match(/## 📥 Backlog[\s\S]*?(?=##|$)/)?.[0] || '';
      const tickets = [...backlogSection.matchAll(/- \[ \] \[\[specs\/[^\]]+\|(T\d+)\]\] ([^#\n]+)/g)];
      
      const ticketList = tickets.map(match => ({
        id: match[1],
        title: match[2].trim(),
        assignee: 'unassigned'
      }));

      const result = await new Promise<{ ticketId: string; agentName: string }>((resolve) => {
        render(
          React.createElement(ClaimTicketUI, {
            tickets: ticketList,
            needsAgentName: !agentName,
            defaultAgentName: agentName,
            onComplete: resolve
          })
        );
      });

      ticketId = result.ticketId;
      if (!agentName) agentName = result.agentName;
    }

    // Find the ticket line in backlog
    const ticketRegex = new RegExp(`(- \\[ \\] \\[\\[specs\\/[^\\]]+\\|${ticketId}\\]\\][^\\n]+)`, 'g');
    const ticketMatch = board.match(ticketRegex);
    
    if (!ticketMatch) {
      this.error(`Ticket ${ticketId} not found in backlog. It may already be claimed.`);
    }

    const ticketLine = ticketMatch[0];
    
    // Update the line: change assignee and move spec location
    let updatedLine = ticketLine.replace('@unassigned', `@${agentName}`);
    
    // Move spec file from backlog to active
    const specMatch = ticketLine.match(/\[\[specs\/backlog\/([^\]]+)\]/);
    if (specMatch) {
      const specFileName = specMatch[1];
      const oldSpecPath = path.join(pmoPath, 'specs', 'backlog', specFileName);
      const newSpecPath = path.join(pmoPath, 'specs', 'active', specFileName);
      
      if (fs.existsSync(oldSpecPath)) {
        fs.renameSync(oldSpecPath, newSpecPath);
        updatedLine = updatedLine.replace('specs/backlog/', 'specs/active/');
        
        // Update spec file with claim info
        let specContent = fs.readFileSync(newSpecPath, 'utf-8');
        specContent = specContent.replace('**Status:** Backlog', '**Status:** In Progress');
        specContent += `\n- Claimed by ${agentName}: ${new Date().toISOString()}`;
        fs.writeFileSync(newSpecPath, specContent);
      }
    }

    // Remove from backlog
    board = board.replace(ticketLine, '');
    
    // Add to in-progress
    board = board.replace(
      /## 🚀 In Progress\n/,
      `## 🚀 In Progress\n${updatedLine}\n`
    );

    // Clean up any double newlines
    board = board.replace(/\n\n+/g, '\n\n');

    // Write updated board
    fs.writeFileSync(boardPath, board);

    // Commit changes
    try {
      execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
      execSync(`git commit -m "${agentName} claimed ${ticketId}"`, { cwd: pmoPath, stdio: 'pipe' });
      execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      this.log(chalk.yellow('Warning: Could not push changes. You may need to push manually.'));
    }

    this.log(styles.success(`✅ Ticket ${ticketId} claimed by ${agentName}`));
    this.log(styles.muted(`   Moved to In Progress`));
    this.log(styles.muted(`   Spec moved to active/`));
  }

  private async getAgentName(): Promise<string> {
    // Try to get from worktree config
    const worktreeRoot = this.findWorktreeRoot();
    if (worktreeRoot) {
      const configPath = path.join(worktreeRoot, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.agentName) {
          return config.agentName;
        }
      }
    }

    // Try global config
    const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      if (config.currentAgent) {
        return config.currentAgent;
      }
    }

    // Return empty string - will be prompted in UI if needed
    return '';
  }

  private findPMO(): string | null {
    let currentDir = process.cwd();
    
    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          const pmoPath = path.join(currentDir, 'pmo');
          if (fs.existsSync(pmoPath)) return pmoPath;
        }
        if (config.pmoPath) {
          const absolutePath = path.isAbsolute(config.pmoPath) 
            ? config.pmoPath 
            : path.join(currentDir, config.pmoPath);
          if (fs.existsSync(absolutePath)) return absolutePath;
        }
      }
      
      const pmoPath = path.join(currentDir, 'pmo');
      if (fs.existsSync(path.join(pmoPath, 'board.md'))) {
        return pmoPath;
      }
      
      currentDir = path.dirname(currentDir);
    }
    
    const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      if (config.defaultPMO && fs.existsSync(config.defaultPMO)) {
        return config.defaultPMO;
      }
    }
    
    return null;
  }

  private findWorktreeRoot(): string | null {
    let currentDir = process.cwd();
    
    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'worktree') {
          return currentDir;
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }
}