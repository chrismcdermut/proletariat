import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../lib/pmo/index.js';
import { styles } from '../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../lib/prompt-json.js';

interface LegacyPMOInfo {
  path: string;
  dbPath: string;
  projectCount: number;
  ticketCount: number;
  type: 'global' | 'standalone';
}

interface HQInfo {
  path: string;
  name: string;
  hasPMO: boolean;
  projectCount: number;
  ticketCount: number;
}

export default class MigratePMO extends Command {
  static description = 'Migrate tickets from a legacy global/standalone PMO to an HQ workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --to my-hq',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static flags = {
    to: Flags.string({
      char: 't',
      description: 'Target HQ workspace name or path',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be migrated without making changes',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePMO);
    const jsonMode = shouldOutputJson(flags);

    // Step 1: Find legacy PMO sources
    this.log(chalk.blue('\nSearching for legacy PMO data...\n'));
    const legacySources = this.findLegacyPMOs();

    if (legacySources.length === 0) {
      this.log(chalk.green('No legacy PMO found. You\'re all set!'));
      this.log(styles.muted('\nTickets are stored in HQ workspaces. Use `prlt init` to create one.'));
      return;
    }

    // Display found sources
    this.log(chalk.yellow('Found legacy PMO data:\n'));
    for (const source of legacySources) {
      const typeLabel = source.type === 'global' ? 'Global PMO' : 'Standalone PMO';
      this.log(`  ${chalk.cyan(typeLabel)}: ${source.path}`);
      this.log(styles.muted(`    Projects: ${source.projectCount}, Tickets: ${source.ticketCount}\n`));
    }

    // Step 2: Find available HQ workspaces
    const hqs = this.findHQWorkspaces();

    if (hqs.length === 0) {
      this.log(chalk.red('\nNo HQ workspace found.'));
      this.log(styles.muted('Create one first with: prlt init --name <name>'));
      return;
    }

    // Step 3: Select or validate target HQ
    let targetHQ: HQInfo | undefined;

    if (flags.to) {
      // Find HQ by name or path
      targetHQ = hqs.find(hq =>
        hq.name === flags.to ||
        hq.path === flags.to ||
        hq.path.endsWith(`/${flags.to}`) ||
        hq.path.endsWith(`/${flags.to}-hq`)
      );

      if (!targetHQ) {
        this.log(chalk.red(`\nHQ "${flags.to}" not found.`));
        this.log(styles.muted('Available HQs:'));
        for (const hq of hqs) {
          this.log(styles.muted(`  - ${hq.name} (${hq.path})`));
        }
        return;
      }
    } else {
      // Prompt for target
      const choices = hqs.map(hq => ({
        name: `${hq.name} (${hq.ticketCount} existing tickets)`,
        value: hq.path,
      }));
      const message = 'Select target HQ workspace:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'targetHQ', message, choices),
          createMetadata('migrate-pmo', flags)
        );
        return;
      }

      const { selectedHQ } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedHQ',
        message,
        choices,
      }]);

      targetHQ = hqs.find(hq => hq.path === selectedHQ);
    }

    if (!targetHQ) {
      this.log(chalk.red('Failed to select target HQ.'));
      return;
    }

    // Step 4: Confirm migration
    this.log(chalk.blue(`\nMigration plan:`));
    this.log(styles.muted(`  From: ${legacySources.map(s => s.path).join(', ')}`));
    this.log(styles.muted(`  To:   ${targetHQ.path}`));

    let totalTickets = 0;
    let totalProjects = 0;
    for (const source of legacySources) {
      totalTickets += source.ticketCount;
      totalProjects += source.projectCount;
    }
    this.log(styles.muted(`  Moving: ${totalProjects} projects, ${totalTickets} tickets\n`));

    if (flags['dry-run']) {
      this.log(chalk.yellow('Dry run - no changes made.'));
      return;
    }

    // Confirm
    const confirmChoices = [
      { name: 'Yes, migrate', value: true },
      { name: 'No, cancel', value: false },
    ];
    const confirmMessage = 'Proceed with migration?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'confirm', confirmMessage, confirmChoices),
        createMetadata('migrate-pmo', flags)
      );
      return;
    }

    const { confirmed } = await inquirer.prompt([{
      type: 'list',
      name: 'confirmed',
      message: confirmMessage,
      choices: confirmChoices,
    }]);

    if (!confirmed) {
      this.log(chalk.yellow('\nMigration cancelled.'));
      return;
    }

    // Step 5: Perform migration
    this.log(chalk.blue('\nMigrating data...\n'));

    for (const source of legacySources) {
      await this.migrateSource(source, targetHQ);
    }

    // Step 6: Clean up legacy sources
    this.log(chalk.blue('\nCleaning up legacy PMO data...\n'));

    const cleanupChoices = [
      { name: 'Yes, delete legacy data', value: true },
      { name: 'No, keep for backup', value: false },
    ];
    const cleanupMessage = 'Delete legacy PMO data after migration?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'cleanup', cleanupMessage, cleanupChoices),
        createMetadata('migrate-pmo', flags)
      );
      return;
    }

    const { cleanup } = await inquirer.prompt([{
      type: 'list',
      name: 'cleanup',
      message: cleanupMessage,
      choices: cleanupChoices,
      default: false,
    }]);

    if (cleanup) {
      for (const source of legacySources) {
        this.cleanupSource(source);
      }
      this.log(chalk.green('  Legacy PMO data deleted.'));
    } else {
      this.log(styles.muted('  Legacy PMO data preserved. You can manually delete it later.'));
    }

    this.log(chalk.green('\nMigration complete!'));
    this.log(styles.muted(`\nYour tickets are now in: ${targetHQ.path}`));
    this.log(styles.muted('All ticket operations will now work from within this HQ.'));
  }

  /**
   * Find legacy PMO sources (global config and standalone .pmo directories)
   */
  private findLegacyPMOs(): LegacyPMOInfo[] {
    const sources: LegacyPMOInfo[] = [];

    // Check global config for defaultPMO
    const globalConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        if (config.defaultPMO) {
          const pmoPath = config.defaultPMO;
          const dbPath = path.join(path.dirname(pmoPath), '.proletariat', 'workspace.db');

          if (fs.existsSync(dbPath)) {
            const counts = this.getDBCounts(dbPath);
            if (counts.ticketCount > 0 || counts.projectCount > 0) {
              sources.push({
                path: pmoPath,
                dbPath,
                ...counts,
                type: 'global',
              });
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for standalone .pmo directories in common locations
    const homeDir = os.homedir();
    const potentialLocations = [
      path.join(homeDir, '.pmo'),
      path.join(process.cwd(), '.pmo'),
    ];

    for (const pmoDir of potentialLocations) {
      const dbPath = path.join(pmoDir, '.proletariat', 'workspace.db');
      if (fs.existsSync(dbPath)) {
        const counts = this.getDBCounts(dbPath);
        if (counts.ticketCount > 0 || counts.projectCount > 0) {
          // Avoid duplicates
          if (!sources.some(s => s.dbPath === dbPath)) {
            sources.push({
              path: pmoDir,
              dbPath,
              ...counts,
              type: 'standalone',
            });
          }
        }
      }
    }

    return sources;
  }

  /**
   * Find available HQ workspaces from machine config
   */
  private findHQWorkspaces(): HQInfo[] {
    const hqs: HQInfo[] = [];

    const machineConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
    if (!fs.existsSync(machineConfigPath)) {
      return hqs;
    }

    try {
      const config = JSON.parse(fs.readFileSync(machineConfigPath, 'utf-8'));
      const workspaces = config.workspaces || {};

      for (const [hqPath] of Object.entries(workspaces)) {
        if (fs.existsSync(hqPath)) {
          const configPath = path.join(hqPath, '.proletariat', 'config.json');
          if (fs.existsSync(configPath)) {
            try {
              const hqConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              if (hqConfig.type === 'hq') {
                const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
                const counts = fs.existsSync(dbPath) ? this.getDBCounts(dbPath) : { projectCount: 0, ticketCount: 0 };

                hqs.push({
                  path: hqPath,
                  name: hqConfig.name || path.basename(hqPath).replace(/-hq$/, ''),
                  hasPMO: counts.projectCount > 0,
                  ...counts,
                });
              }
            } catch {
              // Skip invalid configs
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }

    return hqs;
  }

  /**
   * Get project and ticket counts from a database
   */
  private getDBCounts(dbPath: string): { projectCount: number; ticketCount: number } {
    try {
      const db = new Database(dbPath);

      // Check if tables exist
      const hasProjects = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
      ).get();

      if (!hasProjects) {
        db.close();
        return { projectCount: 0, ticketCount: 0 };
      }

      const projectCount = (db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number }).count;
      const ticketCount = (db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number }).count;

      db.close();
      return { projectCount, ticketCount };
    } catch {
      return { projectCount: 0, ticketCount: 0 };
    }
  }

  /**
   * Migrate data from a legacy source to target HQ
   */
  private async migrateSource(source: LegacyPMOInfo, target: HQInfo): Promise<void> {
    const sourceDb = new Database(source.dbPath);
    const targetDbPath = path.join(target.path, '.proletariat', 'workspace.db');

    // Ensure target has PMO tables
    const targetStorage = new SQLiteStorage(targetDbPath);
    const targetDb = targetStorage.getDatabase();

    try {
      // Migrate projects (with conflict handling)
      const projects = sourceDb.prepare('SELECT * FROM pmo_projects').all();
      for (const project of projects) {
        const proj = project as Record<string, unknown>;
        // Check if project exists
        const existing = targetDb.prepare('SELECT id FROM pmo_projects WHERE id = ?').get(proj.id);
        if (!existing) {
          const columns = Object.keys(proj).join(', ');
          const placeholders = Object.keys(proj).map(() => '?').join(', ');
          targetDb.prepare(`INSERT INTO pmo_projects (${columns}) VALUES (${placeholders})`).run(...Object.values(proj));
          this.log(chalk.green(`  Migrated project: ${proj.name || proj.id}`));
        } else {
          this.log(chalk.yellow(`  Skipped existing project: ${proj.id}`));
        }
      }

      // Migrate workflow statuses
      const statuses = sourceDb.prepare('SELECT * FROM pmo_workflow_statuses').all();
      for (const status of statuses) {
        const stat = status as Record<string, unknown>;
        const existing = targetDb.prepare('SELECT id FROM pmo_workflow_statuses WHERE id = ?').get(stat.id);
        if (!existing) {
          const columns = Object.keys(stat).join(', ');
          const placeholders = Object.keys(stat).map(() => '?').join(', ');
          try {
            targetDb.prepare(`INSERT INTO pmo_workflow_statuses (${columns}) VALUES (${placeholders})`).run(...Object.values(stat));
          } catch {
            // May fail on foreign key, skip
          }
        }
      }

      // Migrate tickets
      const tickets = sourceDb.prepare('SELECT * FROM pmo_tickets').all();
      let migratedCount = 0;
      for (const ticket of tickets) {
        const t = ticket as Record<string, unknown>;
        const existing = targetDb.prepare('SELECT id FROM pmo_tickets WHERE id = ?').get(t.id);
        if (!existing) {
          // Filter out columns that may not exist in target schema
          const validColumns = this.getValidColumns(targetDb, 'pmo_tickets', Object.keys(t));
          const filteredTicket: Record<string, unknown> = {};
          for (const col of validColumns) {
            filteredTicket[col] = t[col];
          }

          const columns = Object.keys(filteredTicket).join(', ');
          const placeholders = Object.keys(filteredTicket).map(() => '?').join(', ');
          try {
            targetDb.prepare(`INSERT INTO pmo_tickets (${columns}) VALUES (${placeholders})`).run(...Object.values(filteredTicket));
            migratedCount++;
          } catch (error) {
            this.log(chalk.yellow(`  Warning: Could not migrate ticket ${t.id}: ${error}`));
          }
        }
      }
      this.log(chalk.green(`  Migrated ${migratedCount} tickets`));

      // Migrate subtasks
      try {
        const subtasks = sourceDb.prepare('SELECT * FROM pmo_subtasks').all();
        for (const subtask of subtasks) {
          const s = subtask as Record<string, unknown>;
          const existing = targetDb.prepare('SELECT id FROM pmo_subtasks WHERE id = ?').get(s.id);
          if (!existing) {
            const validColumns = this.getValidColumns(targetDb, 'pmo_subtasks', Object.keys(s));
            const filteredSubtask: Record<string, unknown> = {};
            for (const col of validColumns) {
              filteredSubtask[col] = s[col];
            }
            const columns = Object.keys(filteredSubtask).join(', ');
            const placeholders = Object.keys(filteredSubtask).map(() => '?').join(', ');
            try {
              targetDb.prepare(`INSERT INTO pmo_subtasks (${columns}) VALUES (${placeholders})`).run(...Object.values(filteredSubtask));
            } catch {
              // Skip on error
            }
          }
        }
      } catch {
        // Table might not exist in source
      }

      // Migrate specs
      try {
        const specs = sourceDb.prepare('SELECT * FROM pmo_specs').all();
        for (const spec of specs) {
          const sp = spec as Record<string, unknown>;
          const existing = targetDb.prepare('SELECT id FROM pmo_specs WHERE id = ?').get(sp.id);
          if (!existing) {
            const validColumns = this.getValidColumns(targetDb, 'pmo_specs', Object.keys(sp));
            const filteredSpec: Record<string, unknown> = {};
            for (const col of validColumns) {
              filteredSpec[col] = sp[col];
            }
            const columns = Object.keys(filteredSpec).join(', ');
            const placeholders = Object.keys(filteredSpec).map(() => '?').join(', ');
            try {
              targetDb.prepare(`INSERT INTO pmo_specs (${columns}) VALUES (${placeholders})`).run(...Object.values(filteredSpec));
            } catch {
              // Skip on error
            }
          }
        }
      } catch {
        // Table might not exist in source
      }

      // Migrate epics
      try {
        const epics = sourceDb.prepare('SELECT * FROM pmo_epics').all();
        for (const epic of epics) {
          const e = epic as Record<string, unknown>;
          const existing = targetDb.prepare('SELECT id FROM pmo_epics WHERE id = ?').get(e.id);
          if (!existing) {
            const validColumns = this.getValidColumns(targetDb, 'pmo_epics', Object.keys(e));
            const filteredEpic: Record<string, unknown> = {};
            for (const col of validColumns) {
              filteredEpic[col] = e[col];
            }
            const columns = Object.keys(filteredEpic).join(', ');
            const placeholders = Object.keys(filteredEpic).map(() => '?').join(', ');
            try {
              targetDb.prepare(`INSERT INTO pmo_epics (${columns}) VALUES (${placeholders})`).run(...Object.values(filteredEpic));
            } catch {
              // Skip on error
            }
          }
        }
      } catch {
        // Table might not exist in source
      }

    } finally {
      sourceDb.close();
      await targetStorage.close();
    }
  }

  /**
   * Get valid columns for a table (columns that exist in the target schema)
   */
  private getValidColumns(db: Database.Database, tableName: string, columns: string[]): string[] {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    const validColumnNames = new Set(tableInfo.map(col => col.name));
    return columns.filter(col => validColumnNames.has(col));
  }

  /**
   * Clean up a legacy PMO source
   */
  private cleanupSource(source: LegacyPMOInfo): void {
    // Remove from global config if it's the defaultPMO
    if (source.type === 'global') {
      const globalConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
      if (fs.existsSync(globalConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
          if (config.defaultPMO === source.path) {
            delete config.defaultPMO;
            fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));
          }
        } catch {
          // Ignore
        }
      }
    }

    // Delete the standalone .pmo directory
    if (source.type === 'standalone' && fs.existsSync(source.path)) {
      try {
        fs.rmSync(source.path, { recursive: true, force: true });
      } catch {
        this.log(chalk.yellow(`  Warning: Could not delete ${source.path}`));
      }
    }
  }
}
