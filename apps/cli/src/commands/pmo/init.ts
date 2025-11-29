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
  createSpecFolders,
} from '../../lib/pmo/index.js';
import { slugify } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';

type StorageType = 'sqlite' | 'git';

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

    // Check if PMO already exists by checking for workspace.db with pmo_projects table
    const hqRoot = this.findHQRoot();
    const dbPath = hqRoot
      ? path.join(hqRoot, '.proletariat', 'workspace.db')
      : path.join(path.dirname(pmoPath), '.proletariat', 'workspace.db');

    if (fs.existsSync(dbPath)) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);
        const result = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
        ).get();
        db.close();

        if (result !== undefined) {
          this.error('PMO already initialized in this location. Use "prlt pmo status" to check.');
        }
      } catch {
        // Ignore errors - database might not be initialized yet
      }
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

    // Otherwise create a mini-HQ in .pmo directory
    // This returns the pmo path, but we'll create .proletariat structure too
    return path.join(process.cwd(), '.pmo', 'pmo');
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

    // Determine if we're in an HQ or creating standalone
    const hqRoot = this.findHQRoot();
    const isStandalone = !hqRoot;

    if (isStandalone) {
      // Create mini-HQ structure for standalone PMO
      // pmoPath is .pmo/pmo, so hqPath is .pmo
      const standaloneHqPath = path.dirname(pmoPath);

      // Create .proletariat directory with config and workspace.db
      const proletariatPath = path.join(standaloneHqPath, '.proletariat');
      fs.mkdirSync(proletariatPath, { recursive: true });

      // Create HQ config
      const hqConfig = {
        type: 'hq',
        name: 'PMO',
        created: new Date().toISOString(),
        version: '2.0.0',
        hasPMO: true,
      };
      fs.writeFileSync(
        path.join(proletariatPath, 'config.json'),
        JSON.stringify(hqConfig, null, 2)
      );

      // Initialize workspace.db with schema
      const dbPath = path.join(proletariatPath, 'workspace.db');
      const dbStorage = new SQLiteStorage(dbPath);

      // Create default project with user-provided board name
      const projectId = slugify(boardName);
      await dbStorage.createProject({
        id: projectId,
        name: boardName,
        description: `PMO project for ${boardName}`,
        template: template,
      });

      dbStorage.setCurrentProject(projectId);
      await dbStorage.init({
        name: boardName,
        columns,
      });
      await dbStorage.close();

      this.log(chalk.green('  ✓ Mini-HQ structure created'));
      this.log(chalk.green('  ✓ workspace.db initialized'));
    } else {
      // For HQ PMOs, create project in workspace.db
      const dbPath = path.join(hqRoot!, '.proletariat', 'workspace.db');
      const dbStorage = new SQLiteStorage(dbPath);

      // Get HQ name from config
      const configPath = path.join(hqRoot!, '.proletariat', 'config.json');
      const hqConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const hqName = hqConfig.name || 'default';

      // Check if project already exists
      const existingProject = await dbStorage.getProject(hqName);
      if (existingProject) {
        await dbStorage.close();
        this.error(`Project "${hqName}" already exists in PMO. Use a different name or delete the existing project first.`);
      }

      // Create project with custom columns for the template
      // Note: createProject automatically creates default columns, but we need to replace them with template columns
      const projectId = slugify(boardName);
      await dbStorage.createProject({
        id: projectId,
        name: boardName,
        description: `Project for ${boardName}`,
        template: template,
      });

      // Replace default columns with template columns
      dbStorage.setCurrentProject(projectId);
      await dbStorage.init({
        name: boardName,
        columns,
      });
      await dbStorage.close();

      this.log(chalk.green('  ✓ PMO tables initialized in workspace.db'));
      this.log(chalk.green(`  ✓ Project "${projectId}" created`));
    }

    // Create PMO directory structure (same for both HQ and standalone)
    fs.mkdirSync(pmoPath, { recursive: true });

    // Create project directory
    // For HQ, use HQ name from config; for standalone, use slugified board name
    let projectId = slugify(boardName);
    if (!isStandalone && hqRoot) {
      try {
        const configPath = path.join(hqRoot, '.proletariat', 'config.json');
        const hqConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        projectId = hqConfig.name || slugify(boardName);
      } catch {
        // Fall back to slugified board name if config read fails
      }
    }

    const projectPath = path.join(pmoPath, 'projects', projectId);
    fs.mkdirSync(projectPath, { recursive: true });

    // Create spec folders
    createSpecFolders(pmoPath, projectId);

    // Create board.md
    const boardContent = createBoardContent(template);
    const boardPath = path.join(projectPath, 'board.md');
    fs.writeFileSync(boardPath, boardContent);
    this.log(chalk.green('  ✓ board.md created'));

    // For git storage, set up git
    if (storage === 'git') {
      await this.setupGitStorage(pmoPath);
    }

    // Create README
    this.createReadme(pmoPath, storage, template);

    this.log(styles.muted(`  Created: ${pmoPath}`));
    this.log(styles.muted(`  Storage: ${storage}`));
    this.log(styles.muted(`  Template: ${template}`));
    this.log(styles.muted(`  Columns: ${columns.join(', ')}`));
  }

  private async setupGitStorage(pmoPath: string): Promise<void> {
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
- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
- Data stored in \`../.proletariat/workspace.db\` (pmo_* tables)

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
