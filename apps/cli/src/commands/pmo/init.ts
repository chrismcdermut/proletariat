import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import {
  SQLiteStorage,
  getColumnsForTemplate,
  createPMO,
  promptForPMOLocation,
  promptForBoardTemplate,
  promptForBoardName,
  promptForCustomColumns,
  determinePMOPath,
  PMOLocation,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, getGHUsername, isGHTokenInEnv } from '../../lib/pr/index.js';

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

    // Get PMO location using shared prompt (or from flag)
    let location: PMOLocation;
    if (flags.location) {
      location = flags.location as PMOLocation;
    } else {
      location = await promptForPMOLocation(hqRoot);
    }

    // Get board template using shared prompt (or from flag)
    let template: string;
    if (flags.template) {
      template = flags.template;
    } else {
      template = await promptForBoardTemplate();
    }

    // Get columns for template
    let columns = getColumnsForTemplate(template);
    if (template === 'custom') {
      columns = await promptForCustomColumns();
    }

    // Get board name using shared prompt (or from flag)
    // Default to {hqname}-kanban pattern
    const hqName = hqRoot ? path.basename(hqRoot).replace(/-hq$/, '') : undefined;
    const defaultBoardName = hqName ? `${hqName}-kanban` : undefined;
    const boardName = flags.name || await promptForBoardName(defaultBoardName);

    // For standalone PMO (no HQ), we need to create mini-HQ structure first
    const isStandalone = !hqRoot;
    let effectiveHqPath: string;

    if (isStandalone) {
      // Create mini-HQ structure
      effectiveHqPath = path.join(process.cwd(), '.pmo');
      await this.createStandaloneHQ(effectiveHqPath);
    } else {
      effectiveHqPath = hqRoot;
    }

    // Use shared createPMO function
    await createPMO({
      hqPath: effectiveHqPath,
      location,
      boardTemplate: template,
      boardName,
      columns,
      storageType: 'sqlite',
    });

    // Initialize git for separate PMO (recommended for syncing across machines)
    if (location === 'separate' && !isStandalone) {
      const pmoPath = determinePMOPath(effectiveHqPath, location);
      await this.initGitForPMO(pmoPath);
    }

    this.log(chalk.green('\n✅ PMO initialized successfully!'));

    // Check GitHub CLI setup for PR workflow
    this.checkGitHubCLI();

    this.logNextSteps();
  }

  /**
   * Create standalone mini-HQ structure for PMO outside of an HQ
   */
  private async createStandaloneHQ(hqPath: string): Promise<void> {
    const proletariatPath = path.join(hqPath, '.proletariat');
    fs.mkdirSync(proletariatPath, { recursive: true });

    // Create minimal config
    const config = {
      type: 'hq',
      name: 'PMO',
      created: new Date().toISOString(),
      version: '2.0.0',
    };
    fs.writeFileSync(
      path.join(proletariatPath, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create workspace.db using SQLiteStorage (which creates tables)
    const dbPath = path.join(proletariatPath, 'workspace.db');
    const storage = new SQLiteStorage(dbPath);
    await storage.close();

    this.log(chalk.green('  ✓ Standalone PMO structure created'));
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
    } catch {
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

  /**
   * Check GitHub CLI setup and provide guidance for PR workflow
   */
  private checkGitHubCLI(): void {
    this.log(styles.muted('\nChecking GitHub CLI for PR workflow...'));

    // Check if gh is installed
    if (!isGHInstalled()) {
      this.log(chalk.yellow('  ⚠ gh CLI not installed'));
      this.log(styles.muted('    Install: brew install gh'));
      this.log(styles.muted('    PR creation will be skipped without gh\n'));
      return;
    }
    this.log(chalk.green('  ✓ gh CLI installed'));

    // Check if gh is authenticated
    if (!isGHAuthenticated()) {
      this.log(chalk.yellow('  ⚠ gh CLI not authenticated'));
      this.log(styles.muted('    Run: gh auth login'));
      this.log(styles.muted('    PR creation will be skipped without auth\n'));
      return;
    }

    const username = getGHUsername();
    this.log(chalk.green(`  ✓ gh authenticated${username ? ` as ${username}` : ''}`));

    // Check if GH_TOKEN is available for devcontainers
    if (isGHTokenInEnv()) {
      this.log(chalk.green('  ✓ GH_TOKEN available for devcontainers'));
    } else {
      this.log(chalk.yellow('  ⚠ GH_TOKEN not set (needed for PR creation in devcontainers)'));
      this.log(styles.muted(''));
      this.log(styles.muted('    To enable PR creation from devcontainers, add to your shell profile:'));
      this.log(styles.muted(''));
      this.log(chalk.cyan("      echo 'export GH_TOKEN=$(gh auth token 2>/dev/null)' >> ~/.zshrc"));
      this.log(styles.muted(''));
      this.log(styles.muted('    Then restart your terminal or run: source ~/.zshrc'));
    }
  }
}
