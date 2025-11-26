import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { styles } from '../../lib/styles.js';

export default class TicketComplete extends Command {
  static description = 'Mark a ticket as complete (move to done)';

  static examples = [
    '<%= config.bin %> <%= command.id %> T0001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to complete',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketComplete);
    
    // Find PMO
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Get agent name for filtering
    const agentName = await this.getAgentName();

    // Pull latest
    try {
      execSync('git pull', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      // Ignore if no remote
    }

    const boardPath = path.join(pmoPath, 'board.md');
    let board = fs.readFileSync(boardPath, 'utf-8');
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Find tickets in progress or review (not in done or backlog)
      const inProgressSection = board.match(/## 🚀 In Progress[\s\S]*?(?=##|$)/)?.[0] || '';
      const inReviewSection = board.match(/## 👀 In Review[\s\S]*?(?=##|$)/)?.[0] || '';
      const blockedSection = board.match(/## 🚧 Blocked[\s\S]*?(?=##|$)/)?.[0] || '';
      
      const allSections = inProgressSection + inReviewSection + blockedSection;
      const tickets = [...allSections.matchAll(/- \[ \] \[\[specs\/[^\]]+\|(T\d+)\]\] ([^#\n]+).*?@(\w+)/g)];
      
      // Filter by agent if in worktree
      const agentTickets = tickets.filter(match => match[3] === agentName);
      const availableTickets = agentTickets.length > 0 ? agentTickets : tickets;
      
      if (availableTickets.length === 0) {
        this.log(chalk.yellow('No tickets available to complete.'));
        return;
      }

      const { selected } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select ticket to complete:',
          choices: availableTickets.map(match => ({
            name: `${match[1]} - ${match[2].trim()} (@${match[3]})`,
            value: match[1]
          }))
        }
      ]);
      ticketId = selected;
    }

    // Find the ticket line
    const ticketRegex = new RegExp(`(- \\[ \\] \\[\\[specs\\/[^\\]]+\\|${ticketId}\\]\\][^\\n]+)`, 'g');
    const ticketMatch = board.match(ticketRegex);
    
    if (!ticketMatch) {
      // Check if already done
      const doneRegex = new RegExp(`- \\[x\\] \\[\\[specs\\/[^\\]]+\\|${ticketId}\\]\\]`, 'g');
      if (board.match(doneRegex)) {
        this.log(chalk.yellow(`Ticket ${ticketId} is already completed.`));
        return;
      }
      this.error(`Ticket ${ticketId} not found on board.`);
    }

    const ticketLine = ticketMatch[0];
    
    // Mark as complete
    let completedLine = ticketLine.replace('- [ ]', '- [x]');
    
    // Remove any blocked indicators
    completedLine = completedLine.replace(/⚠️[^#@\n]*/g, '').trim();
    
    // Move spec file to completed
    const specMatch = ticketLine.match(/\[\[specs\/([^\/]+)\/([^\]]+)\]/);
    if (specMatch) {
      const currentFolder = specMatch[1];
      const specFileName = specMatch[2];
      const oldPath = path.join(pmoPath, 'specs', currentFolder, specFileName);
      const newPath = path.join(pmoPath, 'specs', 'completed', specFileName);
      
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        completedLine = completedLine.replace(`specs/${currentFolder}/`, 'specs/completed/');
        
        // Update spec with completion info
        let specContent = fs.readFileSync(newPath, 'utf-8');
        specContent = specContent.replace(/\*\*Status:\*\* .+/, '**Status:** Completed');
        specContent += `\n- Completed: ${new Date().toISOString()}`;
        fs.writeFileSync(newPath, specContent);
      }
    }

    // Remove from current location
    board = board.replace(ticketLine, '');
    
    // Add to done section
    board = board.replace(
      /## ✅ Done\n/,
      `## ✅ Done\n${completedLine}\n`
    );

    // Clean up double newlines
    board = board.replace(/\n\n+/g, '\n\n');

    // Write updated board
    fs.writeFileSync(boardPath, board);

    // Optional: Ask for completion notes
    const { addNotes } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addNotes',
        message: 'Add completion notes?',
        default: false
      }
    ]);

    let notes = '';
    if (addNotes) {
      const { completionNotes } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'completionNotes',
          message: 'Completion notes:'
        }
      ]);
      notes = completionNotes;
      
      // Add notes to spec if exists
      if (specMatch) {
        const specPath = path.join(pmoPath, 'specs', 'completed', specMatch[2]);
        if (fs.existsSync(specPath)) {
          let specContent = fs.readFileSync(specPath, 'utf-8');
          specContent += `\n## Completion Notes\n${notes}\n`;
          fs.writeFileSync(specPath, specContent);
        }
      }
    }

    // Commit changes
    try {
      execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
      const commitMessage = notes 
        ? `Complete ${ticketId}: ${notes.split('\n')[0].substring(0, 50)}`
        : `Complete ${ticketId}`;
      execSync(`git commit -m "${commitMessage}"`, { cwd: pmoPath, stdio: 'pipe' });
      execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      this.log(chalk.yellow('Warning: Could not push changes. You may need to push manually.'));
    }

    this.log(styles.success(`✅ Ticket ${ticketId} marked as complete!`));

    // Show progress
    const doneCount = (board.match(/- \[x\]/g) || []).length;
    const totalCount = (board.match(/- \[[ x]\]/g) || []).length;
    this.log(styles.muted(`Progress: ${doneCount}/${totalCount} tickets completed`));
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

    // Return empty if not found (not required for complete)
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