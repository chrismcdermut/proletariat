import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import {
  SQLiteStorage,
  getColumnsForTemplate,
  createBoardContent,
  createSpecFolders,
} from '../../lib/pmo/index.js';
import { slugify } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';

export default class PMOInit extends Command {
  static description = 'Initialize PMO (Project Management Office) in current directory or HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --location repo:proletariat --template founder',
    '<%= config.bin %> <%= command.id %> --location separate --template scrum',
  ];

  static flags = {
    location: Flags.string({
      char: 'l',
      description: 'PMO location (separate or repo:name)',
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

    // Check if PMO already exists
    const hqRoot = this.findHQRoot();
    let existingPMO = false;
    let projectCount = 0;
    let ticketCount = 0;

    if (hqRoot) {
      const dbPath = path.join(hqRoot, '.proletariat', 'workspace.db');
      if (fs.existsSync(dbPath)) {
        try {
          const db = new Database(dbPath);
          const result = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
          ).get();

          if (result !== undefined) {
            existingPMO = true;
            // Get counts
            const projectCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number };
            const ticketCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number };
            projectCount = projectCountResult.count;
            ticketCount = ticketCountResult.count;
          }
          db.close();
        } catch (error) {
          // Log error for debugging
          console.error('PMO check error:', error);
          // Ignore errors - database might not be initialized yet
        }
      }
    }

    // If PMO exists, prompt for reinitialize
    if (existingPMO) {
      const shouldReinitialize = await this.promptReinitialize(hqRoot!, projectCount, ticketCount);
      if (!shouldReinitialize) {
        this.log(chalk.yellow('\nCancelled. Existing PMO preserved.'));
        return;
      }

      // Delete existing PMO
      await this.deletePMO(hqRoot!);
    }

    this.log(chalk.blue('🎯 Initializing PMO...\n'));
    this.log(chalk.gray('   Creates board.md and specs/ for project planning'));
    this.log(chalk.gray('   (Data stored in SQLite, synced to markdown files)\n'));

    // Get PMO location (storage is always SQLite)
    const location = flags.location || await this.promptLocation();
    const storage = 'sqlite' as const; // Always use SQLite storage

    // Determine PMO path based on location
    const pmoPath = this.determinePMOPath(location);

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
      template,
      boardName,
      columns,
    });

    // Initialize git for separate PMO (recommended for syncing across machines)
    if (location === 'separate') {
      await this.initGitForPMO(pmoPath);
    }

    this.log(chalk.green('\n✅ PMO initialized successfully!'));
    this.logNextSteps();
  }

  private determinePMOPath(location: string): string {
    const hqRoot = this.findHQRoot();

    if (location === 'separate') {
      if (hqRoot) {
        // Separate at HQ root
        return path.join(hqRoot, 'pmo');
      } else {
        // Standalone mini-HQ
        return path.join(process.cwd(), '.pmo', 'pmo');
      }
    } else if (location.startsWith('repo:')) {
      // Inside a specific repo
      const repoName = location.substring(5); // Remove 'repo:' prefix
      if (!hqRoot) {
        throw new Error('Cannot create PMO in repo outside of an HQ');
      }
      return path.join(hqRoot, 'repos', repoName, 'pmo');
    } else {
      throw new Error(`Invalid location: ${location}`);
    }
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

  private detectRepos(hqRoot: string): Array<{ name: string; path: string }> {
    const reposDir = path.join(hqRoot, 'repos');
    if (!fs.existsSync(reposDir)) {
      return [];
    }

    const entries = fs.readdirSync(reposDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(reposDir, entry.name),
      }));
  }

  private async promptReinitialize(hqRoot: string, projectCount: number, ticketCount: number): Promise<boolean> {
    // Find PMO location from database
    const dbPath = path.join(hqRoot, '.proletariat', 'workspace.db');
    let pmoPath = path.join(hqRoot, 'pmo'); // Default fallback

    try {
      const db = new Database(dbPath);
      const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
      if (result) {
        pmoPath = result.value;
      }
      db.close();
    } catch {
      // Use default if table doesn't exist
    }

    this.log(chalk.yellow('\n⚠️  PMO already exists'));
    this.log(chalk.gray(`   Location: ${pmoPath}`));
    this.log(chalk.gray(`   Projects: ${projectCount}`));
    this.log(chalk.gray(`   Tickets: ${ticketCount}\n`));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Cancel (keep existing PMO)', value: 'cancel' },
        { name: 'Reinitialize (DELETES all data)', value: 'reinitialize' },
      ],
      default: 'cancel',
    }]);

    if (action === 'cancel') {
      return false;
    }

    // Show warning and require typed confirmation
    this.log(chalk.red('\n⚠️  WARNING: This will permanently delete:'));
    this.log(chalk.red('   • All tickets and boards'));
    this.log(chalk.red('   • All specs and documentation'));
    this.log(chalk.red('   • Database tables (pmo_*)\n'));

    const { confirmation } = await inquirer.prompt([{
      type: 'input',
      name: 'confirmation',
      message: 'Type "delete pmo" to confirm:',
    }]);

    if (confirmation !== 'delete pmo') {
      this.log(chalk.yellow('\nCancelled. Confirmation text did not match.'));
      return false;
    }

    return true;
  }

  private async deletePMO(hqRoot: string): Promise<void> {
    this.log(chalk.blue('\n🗑️  Deleting existing PMO...\n'));

    // Delete database tables and get PMO path before dropping settings
    const dbPath = path.join(hqRoot, '.proletariat', 'workspace.db');
    let pmoPath = path.join(hqRoot, 'pmo'); // Default fallback

    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);

      // Get PMO path from database before deleting
      try {
        const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
        if (result) {
          pmoPath = result.value;
        }
      } catch {
        // Ignore - table might not exist, use default
      }

      // Drop all pmo_* tables
      const tables = ['pmo_ticket_specs', 'pmo_ticket_metadata', 'pmo_subtasks', 'pmo_tickets',
                      'pmo_columns', 'pmo_specs', 'pmo_epics', 'pmo_projects',
                      'pmo_initiatives', 'pmo_ticket_assignments', 'pmo_cache_metadata', 'pmo_settings'];

      for (const table of tables) {
        try {
          db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
        } catch {
          // Ignore errors - table might not exist
        }
      }

      db.close();
      this.log(chalk.green('  ✓ Dropped database tables'));
    }

    // Delete pmo/ directory (using path from database or default)
    if (fs.existsSync(pmoPath)) {
      fs.rmSync(pmoPath, { recursive: true, force: true });
      this.log(chalk.green('  ✓ Removed pmo/ directory\n'));
    }
  }

  private async promptLocation(): Promise<string> {
    const hqRoot = this.findHQRoot();
    if (!hqRoot) {
      // Not in an HQ, will create standalone
      return 'separate';
    }

    const repos = this.detectRepos(hqRoot);

    if (repos.length === 0) {
      // No repos - PMO must be at HQ root
      return 'separate';
    } else if (repos.length === 1) {
      // One repo - ask in-repo vs separate
      const { location } = await inquirer.prompt([{
        type: 'list',
        name: 'location',
        message: 'PMO location:',
        choices: [
          {
            name: `Inside repo (${repos[0].name}/pmo)`,
            value: `repo:${repos[0].name}`,
          },
          {
            name: 'Separate from repo (hq/pmo)',
            value: 'separate',
          },
        ],
        default: `repo:${repos[0].name}`,
      }]);
      return location;
    } else {
      // Multiple repos - ask separate vs which repo
      const { location } = await inquirer.prompt([{
        type: 'list',
        name: 'location',
        message: 'PMO location:',
        choices: [
          {
            name: 'Separate from repos (recommended for multi-repo HQs)',
            value: 'separate',
          },
          new inquirer.Separator(),
          ...repos.map(repo => ({
            name: `Inside ${repo.name} repo`,
            value: `repo:${repo.name}`,
          })),
        ],
        default: 'separate',
      }]);
      return location;
    }
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
      template: string;
      boardName: string;
      columns: string[];
    }
  ): Promise<void> {
    const { template, boardName, columns } = options;

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

      // Create project with custom columns for the template
      // Note: createProject automatically creates default columns, but we need to replace them with template columns
      // If we got here, reinitialize already deleted existing data if needed
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

    // Create README
    this.createReadme(pmoPath, template);

    // Save PMO path to database
    const dbPath = isStandalone
      ? path.join(path.dirname(pmoPath), '.proletariat', 'workspace.db')
      : path.join(hqRoot!, '.proletariat', 'workspace.db');

    try {
      const db = Database(dbPath);
      db.prepare('INSERT OR REPLACE INTO pmo_settings (key, value) VALUES (?, ?)').run('pmo_path', pmoPath);
      db.close();
    } catch (error) {
      this.log(chalk.yellow('  ⚠ Could not save PMO path to database'));
    }

    this.log(styles.muted(`  Created: ${pmoPath}`));
    this.log(styles.muted(`  Storage: SQLite (workspace.db)`));
    this.log(styles.muted(`  Template: ${template}`));
    this.log(styles.muted(`  Columns: ${columns.join(', ')}`));
  }


  private createReadme(pmoPath: string, template: string): void {
    const readme = `# PMO (Project Management Office)

## Storage: SQLite
## Template: ${template}

## Structure
- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
- Data stored in \`../.proletariat/workspace.db\` (pmo_* tables)

## Commands
\`\`\`bash
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

# View/manage specs
prlt spec list
prlt spec create
prlt spec view <spec-id>
prlt spec generate-tickets <spec-id>
\`\`\`

## Obsidian Setup
1. Open this folder as an Obsidian vault
2. Install the "Kanban" plugin
3. Open board.md and switch to Kanban view
`;

    fs.writeFileSync(path.join(pmoPath, 'README.md'), readme);
  }

  private async initGitForPMO(pmoPath: string): Promise<void> {
    try {
      // Create .gitignore
      const gitignore = `# Proletariat PMO
.DS_Store
*.swp
*.swo
*~
.vscode/
.idea/
`;
      fs.writeFileSync(path.join(pmoPath, '.gitignore'), gitignore);

      // Initialize git repo
      execSync('git init', { cwd: pmoPath, stdio: 'pipe' });
      execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
      execSync('git commit -m "Initialize PMO\n\nCreated with Proletariat CLI"', { cwd: pmoPath, stdio: 'pipe' });

      this.log(chalk.green('  ✓ Git repository initialized'));
      this.log(styles.muted('    Add remote: cd pmo && git remote add origin <url>'));
    } catch (error) {
      this.log(chalk.yellow('  ⚠ Git initialization failed (continuing without git)'));
      this.log(styles.muted('    You can initialize git manually: cd pmo && git init'));
    }
  }

  private logNextSteps(): void {
    this.log(styles.muted('\nNext steps:'));
    this.log(styles.muted('  1. Create your first ticket: prlt ticket create'));
    this.log(styles.muted('  2. Create a spec: prlt spec create'));
    this.log(styles.muted('  3. Open pmo/ in Obsidian for visual kanban'));
  }
}
