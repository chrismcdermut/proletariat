import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import * as React from 'react';
import { render } from 'ink';
import { CreateTicketUI } from '../../lib/ui/CreateTicketUI.js';

export default class TicketCreate extends Command {
  static description = 'Create a new ticket with spec and add to kanban board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> "Fix login bug"',
  ];

  static args = {
    title: Args.string({
      description: 'Ticket title',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketCreate);
    
    // Find PMO directory
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Pull latest
    try {
      execSync('git pull', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      // Ignore if no remote
    }

    // Load config to get next ticket ID
    const configPath = path.join(pmoPath, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const ticketNumber = config.lastTicketId + 1;
    const ticketId = `T${String(ticketNumber).padStart(4, '0')}`;

    // Use Ink UI for ticket creation
    const ticketData = await new Promise<{
      title: string;
      priority: 'high' | 'medium' | 'low';
      queue: string;
      description: string;
    }>((resolve) => {
      render(
        React.createElement(CreateTicketUI, {
          initialTitle: args.title,
          queues: config.queues || ['feature', 'bug', 'refactor'],
          onComplete: resolve
        })
      );
    });

    const { title, priority, queue, description } = ticketData;

    // Create safe filename from title
    const safeTitle = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    const specFileName = `${ticketId}-${safeTitle}.md`;

    // Create spec file
    const specPath = path.join(pmoPath, 'specs', 'backlog', specFileName);
    const specContent = `# ${ticketId}: ${title}

**Priority:** ${priority}
**Queue:** ${queue}
**Created:** ${new Date().toISOString()}
**Status:** Backlog

## Description
${description}

## Work Log
- Created: ${new Date().toISOString()}
`;

    fs.writeFileSync(specPath, specContent);

    // Add to kanban board
    const boardPath = path.join(pmoPath, 'board.md');
    let board = fs.readFileSync(boardPath, 'utf-8');
    
    // Create the kanban card
    const card = `- [ ] [[specs/backlog/${specFileName}|${ticketId}]] ${title} #${priority} +${queue} @unassigned`;
    
    // Add to backlog section
    board = board.replace(
      /## 📥 Backlog\n/,
      `## 📥 Backlog\n${card}\n`
    );

    fs.writeFileSync(boardPath, board);

    // Update config with new ticket ID
    config.lastTicketId = ticketNumber;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Commit changes
    try {
      execSync(`git add .`, { cwd: pmoPath, stdio: 'pipe' });
      execSync(`git commit -m "Create ticket ${ticketId}: ${title}"`, { cwd: pmoPath, stdio: 'pipe' });
      execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
    } catch (error) {
      this.log(chalk.yellow('Warning: Could not commit changes. You may need to commit manually.'));
    }

    this.log(chalk.green(`\n✅ Created ticket ${chalk.bold(ticketId)}`));
    this.log(chalk.gray(`   Title: ${title}`));
    this.log(chalk.gray(`   Priority: ${priority}`));
    this.log(chalk.gray(`   Queue: ${queue}`));
    this.log(chalk.gray(`   Spec: ${specPath}`));
    this.log(chalk.gray(`\n   View board: prlt pmo board`));
  }

  private findPMO(): string | null {
    // Look for PMO in current directory structure
    let currentDir = process.cwd();
    
    while (currentDir !== '/') {
      // Check for .proletariat config
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        // If this is HQ, PMO is in ./pmo
        if (config.type === 'hq') {
          const pmoPath = path.join(currentDir, 'pmo');
          if (fs.existsSync(pmoPath)) return pmoPath;
        }
        
        // If config has pmoPath
        if (config.pmoPath) {
          const absolutePath = path.isAbsolute(config.pmoPath) 
            ? config.pmoPath 
            : path.join(currentDir, config.pmoPath);
          if (fs.existsSync(absolutePath)) return absolutePath;
        }
      }
      
      // Check for direct pmo folder
      const pmoPath = path.join(currentDir, 'pmo');
      if (fs.existsSync(path.join(pmoPath, 'board.md'))) {
        return pmoPath;
      }
      
      currentDir = path.dirname(currentDir);
    }
    
    // Check global config
    const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      if (config.defaultPMO && fs.existsSync(config.defaultPMO)) {
        return config.defaultPMO;
      }
    }
    
    return null;
  }
}