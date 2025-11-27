import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  SQLiteStorage,
  getColumnsForTemplate,
  createBoardContent,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

type StorageType = 'sqlite' | 'git';

interface PMOConfig {
  storage: StorageType;
  template: string;
  boardName: string;
  columns: string[];
  created: string;
  // Git-specific
  gitRemote?: string;
  autoSync?: boolean;
}

export default class PMOInit extends Command {
  static description = 'Initialize PMO (Project Management Office) in current directory or HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --storage git --template scrum',
    '<%= config.bin %> <%= command.id %> --storage sqlite --template founder',
  ];

  static flags = {
    storage: Flags.string({
      char: 's',
      description: 'Storage backend',
      options: ['sqlite', 'git'],
    }),
    template: Flags.string({
      char: 't',
      description: 'Board template',
      options: ['kanban', 'scrum', 'founder', 'custom'],
    }),
    name: Flags.string({
      char: 'n',
      description: 'Board name',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PMOInit);

    // Determine PMO location
    const pmoPath = this.determinePMOPath();

    // Check if PMO already exists
    if (fs.existsSync(path.join(pmoPath, '.pmo'))) {
      this.error('PMO already initialized in this location. Use "prlt pmo status" to check.');
    }

    this.log(chalk.blue('🎯 Initializing PMO...\n'));

    // Get storage type
    const storage = flags.storage as StorageType || await this.promptStorageType();

    // Get board template
    const template = flags.template || await this.promptTemplate();

    // Get board name
    const boardName = flags.name || await this.promptBoardName();

    // Get columns for template
    let columns = getColumnsForTemplate(template);
    if (template === 'custom') {
      columns = await this.promptCustomColumns();
    }

    // Create PMO structure
    await this.createPMOStructure(pmoPath, {
      storage,
      template,
      boardName,
      columns,
    });

    this.log(chalk.green('\n✅ PMO initialized successfully!'));
    this.logNextSteps(storage);
  }

  private determinePMOPath(): string {
    // Check if we're in an HQ
    const hqRoot = this.findHQRoot();
    if (hqRoot) {
      return path.join(hqRoot, 'pmo');
    }

    // Otherwise use current directory
    return path.join(process.cwd(), '.pmo');
  }

  private findHQRoot(): string | null {
    let currentDir = process.cwd();

    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.type === 'hq') {
            return currentDir;
          }
        } catch {
          // Ignore parse errors
        }
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  private async promptStorageType(): Promise<StorageType> {
    const { storage } = await inquirer.prompt([{
      type: 'list',
      name: 'storage',
      message: 'Choose storage backend:',
      choices: [
        {
          name: 'SQLite (local only, fast, no sync)',
          value: 'sqlite',
        },
        {
          name: 'Git (markdown file + cache, sync via git)',
          value: 'git',
        },
        // {
        //   name: 'Cloud (coming soon)',
        //   value: 'cloud',
        //   disabled: 'Not yet implemented',
        // },
      ],
      default: 'sqlite',
    }]);
    return storage;
  }

  private async promptTemplate(): Promise<string> {
    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Choose board template:',
      choices: [
        { name: 'Kanban (Backlog, In Progress, Done)', value: 'kanban' },
        { name: 'Scrum (+ In Review, Blocked)', value: 'scrum' },
        { name: '5-Tool Founder (BUILD/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)', value: 'founder' },
        { name: 'Custom (define your own columns)', value: 'custom' },
      ],
      default: 'kanban',
    }]);
    return template;
  }

  private async promptBoardName(): Promise<string> {
    const { name } = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: 'Board name:',
      default: 'Project Board',
    }]);
    return name;
  }

  private async promptCustomColumns(): Promise<string[]> {
    const { columnsInput } = await inquirer.prompt([{
      type: 'input',
      name: 'columnsInput',
      message: 'Enter column names (comma-separated):',
      default: 'Backlog, In Progress, Done',
      validate: (input: string) => {
        const cols = input.split(',').map(c => c.trim()).filter(Boolean);
        if (cols.length < 2) {
          return 'Please enter at least 2 columns';
        }
        return true;
      },
    }]);
    return columnsInput.split(',').map((c: string) => c.trim()).filter(Boolean);
  }

  private async createPMOStructure(
    pmoPath: string,
    options: {
      storage: StorageType;
      template: string;
      boardName: string;
      columns: string[];
    }
  ): Promise<void> {
    const { storage, template, boardName, columns } = options;

    // Create directories
    fs.mkdirSync(pmoPath, { recursive: true });
    fs.mkdirSync(path.join(pmoPath, 'specs'), { recursive: true });

    // Create PMO config
    const config: PMOConfig = {
      storage,
      template,
      boardName,
      columns,
      created: new Date().toISOString(),
    };

    // Storage-specific setup
    if (storage === 'sqlite') {
      await this.setupSQLiteStorage(pmoPath, boardName, columns, template);
    } else if (storage === 'git') {
      await this.setupGitStorage(pmoPath, boardName, columns, template, config);
    }

    // Write config
    fs.writeFileSync(
      path.join(pmoPath, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create README
    this.createReadme(pmoPath, storage, template);

    this.log(styles.muted(`  Created: ${pmoPath}`));
    this.log(styles.muted(`  Storage: ${storage}`));
    this.log(styles.muted(`  Template: ${template}`));
    this.log(styles.muted(`  Columns: ${columns.join(', ')}`));
  }

  private async setupSQLiteStorage(
    pmoPath: string,
    boardName: string,
    columns: string[],
    template: string
  ): Promise<void> {
    // Create board.md for Obsidian viewing
    const boardContent = createBoardContent(template);
    fs.writeFileSync(path.join(pmoPath, 'board.md'), boardContent);
    this.log(chalk.green('  ✓ board.md created'));

    // Create SQLite database (source of truth)
    const dbPath = path.join(pmoPath, 'board.db');
    const storage = new SQLiteStorage(dbPath);

    await storage.init({
      name: boardName,
      columns,
    });

    await storage.close();

    this.log(chalk.green('  ✓ SQLite database created'));
  }

  private async setupGitStorage(
    pmoPath: string,
    boardName: string,
    columns: string[],
    template: string,
    config: PMOConfig
  ): Promise<void> {
    // Create board.md (source of truth for git)
    const boardContent = createBoardContent(template);
    fs.writeFileSync(path.join(pmoPath, 'board.md'), boardContent);
    this.log(chalk.green('  ✓ board.md created'));

    // Create SQLite cache
    const cachePath = path.join(pmoPath, '.cache.db');
    const cache = new SQLiteStorage(cachePath);
    await cache.init({
      name: boardName,
      columns,
    });
    await cache.close();
    this.log(chalk.green('  ✓ SQLite cache created'));

    // Ask about git init
    const { initGit } = await inquirer.prompt([{
      type: 'list',
      name: 'initGit',
      message: 'Initialize git repository for PMO?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
      default: 0,
    }]);

    if (initGit) {
      try {
        // Create .gitignore
        const gitignore = `.cache.db
.cache.db-journal
.DS_Store
`;
        fs.writeFileSync(path.join(pmoPath, '.gitignore'), gitignore);

        execSync('git init', { cwd: pmoPath, stdio: 'pipe' });
        execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
        execSync('git commit -m "Initialize PMO"', { cwd: pmoPath, stdio: 'pipe' });

        this.log(chalk.green('  ✓ Git repository initialized'));

        // Ask about remote
        const { addRemote } = await inquirer.prompt([{
          type: 'list',
          name: 'addRemote',
          message: 'Add a git remote?',
          choices: [
            { name: 'No', value: false },
            { name: 'Yes', value: true },
          ],
          default: 0,
        }]);

        if (addRemote) {
          const { remoteUrl } = await inquirer.prompt([{
            type: 'input',
            name: 'remoteUrl',
            message: 'Remote URL:',
            validate: (input: string) => input.length > 0 || 'Please enter a URL',
          }]);

          execSync(`git remote add origin ${remoteUrl}`, { cwd: pmoPath, stdio: 'pipe' });
          config.gitRemote = remoteUrl;
          this.log(chalk.green(`  ✓ Remote added: ${remoteUrl}`));
        }
      } catch (error) {
        this.log(chalk.yellow('  ⚠ Git initialization failed. You can set it up manually.'));
      }
    }
  }

  private createReadme(pmoPath: string, storage: StorageType, template: string): void {
    const readme = `# PMO (Project Management Office)

## Storage: ${storage}
## Template: ${template}

## Structure
- **config.json** - PMO configuration
${storage === 'git' ? '- **board.md** - Kanban board (Obsidian compatible)\n- **.cache.db** - Local SQLite cache (gitignored)' : '- **board.db** - SQLite database'}
- **specs/** - Detailed specifications for tickets

## Commands
\`\`\`bash
# View board
prlt board view

# Create ticket
prlt ticket create --title "My ticket" --column "Backlog"

# List tickets
prlt ticket list
prlt ticket list --column "In Progress"
prlt ticket list --priority URGENT

# Move ticket
prlt ticket move <ticket-id> "In Progress"

# Update ticket
prlt ticket update <ticket-id> --priority HIGH

${storage === 'git' ? `# Sync (git storage)
prlt board pull
prlt board push
` : ''}
\`\`\`

${storage === 'git' ? `## Obsidian Setup
1. Open this folder as an Obsidian vault
2. Install the "Kanban" plugin
3. Open board.md and switch to Kanban view
` : ''}
`;

    fs.writeFileSync(path.join(pmoPath, 'README.md'), readme);
  }

  private logNextSteps(storage: StorageType): void {
    this.log(styles.muted('\nNext steps:'));
    this.log(styles.muted('  1. Create your first ticket: prlt ticket create'));
    this.log(styles.muted('  2. View the board: prlt board view'));

    if (storage === 'git') {
      this.log(styles.muted('  3. Open in Obsidian for visual kanban'));
      this.log(styles.muted('  4. Push to remote: prlt board push'));
    }
  }
}
