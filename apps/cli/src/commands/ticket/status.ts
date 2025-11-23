import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

export default class TicketStatus extends Command {
  static description = 'Update ticket status (move between board columns)';

  static examples = [
    '<%= config.bin %> <%= command.id %> T0001 in-review',
    '<%= config.bin %> <%= command.id %> T0001 blocked "Waiting for API"',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    status: Args.string({
      description: 'New status',
      options: ['in-progress', 'in-review', 'blocked', 'done'],
      required: true,
    }),
    reason: Args.string({
      description: 'Reason for status change (for blocked)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketStatus);
    const { ticketId, status, reason } = args;
    
    // Find PMO
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

    const boardPath = path.join(pmoPath, 'board.md');
    let board = fs.readFileSync(boardPath, 'utf-8');

    // Find the ticket in any section
    const ticketRegex = new RegExp(`(- \\[[ x]\\] \\[\\[specs\\/[^\\]]+\\|${ticketId}\\]\\][^\\n]+)`, 'g');
    const ticketMatch = board.match(ticketRegex);
    
    if (!ticketMatch) {
      this.error(`Ticket ${ticketId} not found on board.`);
    }

    const ticketLine = ticketMatch[0];
    let updatedLine = ticketLine;

    // Handle status-specific updates
    if (status === 'blocked' && reason) {
      // Add blocked indicator
      updatedLine = updatedLine.replace(/\n|$/, ` ⚠️ ${reason}`);
    } else if (status === 'done') {
      // Mark checkbox as complete
      updatedLine = updatedLine.replace('- [ ]', '- [x]');
    }

    // Remove ticket from current location
    board = board.replace(ticketLine, '');

    // Add to new section
    const sectionMap: Record<string, string> = {
      'in-progress': '## 🚀 In Progress',
      'in-review': '## 👀 In Review',
      'blocked': '## 🚧 Blocked',
      'done': '## ✅ Done'
    };

    const targetSection = sectionMap[status];
    
    // Add blocked section if it doesn't exist
    if (status === 'blocked' && !board.includes('## 🚧 Blocked')) {
      // Add blocked section after In Progress
      board = board.replace(
        /## 🚀 In Progress\n([\s\S]*?)(?=##)/,
        `## 🚀 In Progress\n$1\n## 🚧 Blocked\n\n`
      );
    }

    // Add to target section
    board = board.replace(
      new RegExp(`${targetSection}\\n`),
      `${targetSection}\n${updatedLine}\n`
    );

    // Clean up double newlines
    board = board.replace(/\n\n+/g, '\n\n');

    // Update spec file location and status
    const specMatch = ticketLine.match(/\[\[specs\/([^\/]+)\/([^\]]+)\]/);
    if (specMatch) {
      const currentFolder = specMatch[1];
      const specFileName = specMatch[2];
      
      // Determine new folder based on status
      const folderMap: Record<string, string> = {
        'in-progress': 'active',
        'in-review': 'active',
        'blocked': 'active',
        'done': 'completed'
      };
      
      const newFolder = folderMap[status];
      
      if (currentFolder !== newFolder) {
        const oldPath = path.join(pmoPath, 'specs', currentFolder, specFileName);
        const newPath = path.join(pmoPath, 'specs', newFolder, specFileName);
        
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
          
          // Update spec content
          let specContent = fs.readFileSync(newPath, 'utf-8');
          specContent = specContent.replace(/\*\*Status:\*\* .+/, `**Status:** ${status}`);
          specContent += `\n- Status changed to ${status}: ${new Date().toISOString()}`;
          if (reason) {
            specContent += `\n  Reason: ${reason}`;
          }
          fs.writeFileSync(newPath, specContent);
          
          // Update board link
          board = board.replace(
            `specs/${currentFolder}/${specFileName}`,
            `specs/${newFolder}/${specFileName}`
          );
        }
      }
    }

    // Write updated board
    fs.writeFileSync(boardPath, board);

    // Commit changes
    try {
      execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
      const commitMessage = reason 
        ? `Update ${ticketId} status to ${status}: ${reason}`
        : `Update ${ticketId} status to ${status}`;
      execSync(`git commit -m "${commitMessage}"`, { cwd: pmoPath, stdio: 'pipe' });
      execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      this.log(chalk.yellow('Warning: Could not push changes. You may need to push manually.'));
    }

    this.log(chalk.green(`✅ Updated ${ticketId} status to ${status}`));
    if (reason) {
      this.log(chalk.gray(`   Reason: ${reason}`));
    }
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
}