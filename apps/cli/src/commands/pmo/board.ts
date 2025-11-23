import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

export default class PMOBoard extends Command {
  static description = 'View or edit the kanban board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> view',
    '<%= config.bin %> <%= command.id %> edit',
  ];

  static args = {
    action: Args.string({
      description: 'Action to perform',
      options: ['view', 'edit', 'open'],
      default: 'view'
    })
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PMOBoard);
    
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const boardPath = path.join(pmoPath, 'board.md');
    
    if (!fs.existsSync(boardPath)) {
      this.error('Board not found. Run "prlt pmo init" to create it.');
    }

    // Pull latest changes
    try {
      execSync('git pull', { cwd: pmoPath, stdio: 'pipe' });
    } catch {
      // Ignore if no remote set
    }

    switch (args.action) {
      case 'view':
        this.viewBoard(boardPath);
        break;
      
      case 'edit':
        this.editBoard(boardPath, pmoPath);
        break;
        
      case 'open':
        this.openInObsidian(pmoPath);
        break;
    }
  }

  private viewBoard(boardPath: string): void {
    const board = fs.readFileSync(boardPath, 'utf-8');
    
    // Parse and display with colors
    const lines = board.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
      if (line.startsWith('# ')) {
        this.log(chalk.bold.cyan(line));
      } else if (line.startsWith('## ')) {
        currentSection = line;
        if (line.includes('Backlog')) {
          this.log(chalk.blue(line));
        } else if (line.includes('In Progress')) {
          this.log(chalk.yellow(line));
        } else if (line.includes('In Review')) {
          this.log(chalk.magenta(line));
        } else if (line.includes('Done')) {
          this.log(chalk.green(line));
        } else {
          this.log(chalk.bold(line));
        }
      } else if (line.startsWith('- [ ]')) {
        // Uncompleted task
        const match = line.match(/\[\[specs\/(T\d+)[^\]]*\]\]/);
        const ticketId = match ? match[1] : '';
        const assignee = line.match(/@(\w+)/)?.[1] || 'unassigned';
        const priority = line.match(/#(\w+)/)?.[1] || '';
        
        let coloredLine = line;
        if (assignee !== 'unassigned') {
          coloredLine = coloredLine.replace(`@${assignee}`, chalk.cyan(`@${assignee}`));
        }
        if (priority) {
          if (priority === 'high') {
            coloredLine = coloredLine.replace(`#${priority}`, chalk.red(`#${priority}`));
          } else if (priority === 'medium') {
            coloredLine = coloredLine.replace(`#${priority}`, chalk.yellow(`#${priority}`));
          } else {
            coloredLine = coloredLine.replace(`#${priority}`, chalk.gray(`#${priority}`));
          }
        }
        if (ticketId) {
          coloredLine = coloredLine.replace(ticketId, chalk.bold(ticketId));
        }
        
        this.log(coloredLine);
      } else if (line.startsWith('- [x]')) {
        // Completed task
        this.log(chalk.green(line));
      } else if (line.startsWith('---')) {
        this.log(chalk.gray(line));
      } else if (line.startsWith('*') || line.startsWith('<!--')) {
        this.log(chalk.gray(line));
      } else {
        this.log(line);
      }
    }

    // Show summary
    const backlogCount = (board.match(/## 📥 Backlog[\s\S]*?(?=##|$)/)?.[0].match(/- \[ \]/g) || []).length;
    const inProgressCount = (board.match(/## 🚀 In Progress[\s\S]*?(?=##|$)/)?.[0].match(/- \[ \]/g) || []).length;
    const reviewCount = (board.match(/## 👀 In Review[\s\S]*?(?=##|$)/)?.[0].match(/- \[ \]/g) || []).length;
    const doneCount = (board.match(/## ✅ Done[\s\S]*?(?=##|$)/)?.[0].match(/- \[x\]/g) || []).length;

    this.log(chalk.gray('\n─────────────────────'));
    this.log(chalk.bold('Summary:'));
    this.log(`  Backlog: ${chalk.blue(backlogCount)}`);
    this.log(`  In Progress: ${chalk.yellow(inProgressCount)}`);
    this.log(`  In Review: ${chalk.magenta(reviewCount)}`);
    this.log(`  Done: ${chalk.green(doneCount)}`);
  }

  private editBoard(boardPath: string, pmoPath: string): void {
    const editor = process.env.EDITOR || 'vi';
    
    this.log(chalk.blue(`Opening board in ${editor}...`));
    
    // Open in editor
    execSync(`${editor} ${boardPath}`, { stdio: 'inherit' });
    
    // After editing, commit changes
    try {
      execSync('git add board.md', { cwd: pmoPath, stdio: 'pipe' });
      execSync('git commit -m "Manual board update"', { cwd: pmoPath, stdio: 'pipe' });
      execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
      this.log(chalk.green('✅ Board changes committed and pushed'));
    } catch {
      this.log(chalk.yellow('No changes to commit or no remote configured'));
    }
  }

  private openInObsidian(pmoPath: string): void {
    const platform = process.platform;
    
    try {
      if (platform === 'darwin') {
        // macOS
        execSync(`open "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      } else if (platform === 'linux') {
        // Linux
        execSync(`xdg-open "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      } else if (platform === 'win32') {
        // Windows
        execSync(`start "" "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      }
      this.log(chalk.green('✅ Opened PMO in Obsidian'));
    } catch (error) {
      this.log(chalk.yellow('Could not open Obsidian. Make sure it is installed.'));
      this.log(chalk.gray(`PMO location: ${pmoPath}`));
    }
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