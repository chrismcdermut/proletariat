import { Command } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';

export default class PMOInit extends Command {
  static description = 'Initialize PMO (Project Management Office) in current HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    // Find HQ root
    const hqRoot = this.findHQRoot();
    if (!hqRoot) {
      this.error('Not in an HQ directory. Run "prlt init" first to create an HQ.');
    }

    const pmoPath = path.join(hqRoot, 'pmo');
    
    // Check if PMO already exists
    if (fs.existsSync(path.join(pmoPath, '.git'))) {
      this.log(chalk.yellow('PMO already initialized!'));
      return;
    }

    this.log(chalk.blue('🎯 Initializing PMO...'));

    // Create PMO structure
    const dirs = [
      pmoPath,
      path.join(pmoPath, 'specs'),
      path.join(pmoPath, 'specs', 'backlog'),
      path.join(pmoPath, 'specs', 'active'),  
      path.join(pmoPath, 'specs', 'completed'),
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Ask about board setup
    const { boardName, queues } = await inquirer.prompt([
      {
        type: 'input',
        name: 'boardName',
        message: 'What should we call your kanban board?',
        default: 'Project Board'
      },
      {
        type: 'checkbox',
        name: 'queues',
        message: 'Select work queues/categories:',
        choices: [
          { name: 'Feature', value: 'feature', checked: true },
          { name: 'Bug', value: 'bug', checked: true },
          { name: 'Refactor', value: 'refactor', checked: true },
          { name: 'Docs', value: 'docs', checked: false },
          { name: 'DevOps', value: 'devops', checked: false },
          { name: 'Research', value: 'research', checked: false }
        ]
      }
    ]);

    // Create the kanban board for Obsidian
    const boardContent = `# ${boardName}

## 📥 Backlog

## 🚀 In Progress

## 👀 In Review

## ✅ Done

---
*Queues: ${queues.join(', ')}*
*Created: ${new Date().toISOString()}*

<!-- 
Tips for Obsidian Kanban:
- Drag cards between columns
- Click cards to open linked specs
- Use [[specs/T0001-title]] format for linking
- Add @assignee for assignments
- Add #priority for priority (high/medium/low)
- Add +queue for queue type (${queues.join('/')})
-->
`;

    fs.writeFileSync(path.join(pmoPath, 'board.md'), boardContent);

    // Create PMO README
    const readmeContent = `# PMO (Project Management Office)

## Structure
- **board.md** - Kanban board (use with Obsidian Kanban plugin)
- **specs/** - Detailed specifications for tickets
  - **backlog/** - Not started
  - **active/** - In progress
  - **completed/** - Done

## Workflow
1. Create ticket: \`prlt ticket create\`
2. View board: \`prlt pmo board\`
3. Claim ticket: \`prlt ticket claim T0001\`
4. Complete ticket: \`prlt ticket complete T0001\`

## Obsidian Setup
1. Install "Kanban" plugin in Obsidian
2. Open this folder as vault
3. Open board.md
4. Switch to Kanban view
`;

    fs.writeFileSync(path.join(pmoPath, 'README.md'), readmeContent);

    // Create next ticket ID tracker
    const configContent = {
      lastTicketId: 0,
      boardName: boardName,
      queues: queues,
      created: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(pmoPath, 'config.json'),
      JSON.stringify(configContent, null, 2)
    );

    // Initialize git repository for PMO
    const { gitInit } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'gitInit',
        message: 'Initialize git repository for PMO?',
        default: true
      }
    ]);

    if (gitInit) {
      try {
        execSync('git init', { cwd: pmoPath, stdio: 'pipe' });
        
        // Create .gitignore
        const gitignoreContent = `# OS
.DS_Store
Thumbs.db

# Obsidian
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/core-plugins-migration.json
`;
        fs.writeFileSync(path.join(pmoPath, '.gitignore'), gitignoreContent);
        
        // Initial commit
        execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
        execSync('git commit -m "Initialize PMO"', { cwd: pmoPath, stdio: 'pipe' });
        
        this.log(chalk.green('✅ Git repository initialized for PMO'));
      } catch (error) {
        this.log(chalk.yellow('⚠️  Git initialization failed. You can set it up manually.'));
      }
    }

    // Update HQ config to know about PMO
    const hqConfigPath = path.join(hqRoot, '.proletariat', 'config.json');
    const hqConfig = JSON.parse(fs.readFileSync(hqConfigPath, 'utf-8'));
    hqConfig.pmoPath = './pmo';
    hqConfig.pmoInitialized = new Date().toISOString();
    fs.writeFileSync(hqConfigPath, JSON.stringify(hqConfig, null, 2));

    this.log(chalk.green('\n✅ PMO initialized successfully!'));
    this.log(chalk.gray('\nNext steps:'));
    this.log(chalk.gray('  1. Open pmo/ folder in Obsidian'));
    this.log(chalk.gray('  2. Install Kanban plugin'));
    this.log(chalk.gray('  3. Open board.md in Kanban view'));
    this.log(chalk.gray('  4. Create your first ticket: prlt ticket create'));
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