import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { findHQRoot, isValidHQ } from '../lib/workspace.js';

interface MachineConfig {
  headquarters?: Array<{ name: string; path: string }>;
  workspaces?: Array<{ name: string; path: string }>;
  defaultPMO?: string;
}

interface TicketRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  category: string | null;
  status_id: string | null;
  owner: string | null;
  assignee: string | null;
  spec_id: string | null;
  epic_id: string | null;
  labels: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  template: string | null;
  created_at: string;
  updated_at: string;
  workflow_id: string | null;
}

interface StatusRow {
  id: string;
  workflow_id: string;
  name: string;
  category: string;
  position: number;
  is_default: number;
}

export default class MigratePMO extends Command {
  static description = 'Migrate tickets from a standalone PMO to an HQ workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> --to my-hq',
    '<%= config.bin %> <%= command.id %> --from /path/to/.pmo --to /path/to/my-hq',
    '<%= config.bin %> <%= command.id %> --list',
  ];

  static flags = {
    from: Flags.string({
      description: 'Path to standalone PMO directory (default: auto-detect)',
      char: 'f',
    }),
    to: Flags.string({
      description: 'Target HQ name or path',
      char: 't',
    }),
    list: Flags.boolean({
      description: 'List available PMOs and HQs without migrating',
      default: false,
    }),
    'keep-source': Flags.boolean({
      description: 'Keep the source PMO after migration (default: prompt to delete)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Skip confirmation prompts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePMO);

    // List mode: show available PMOs and HQs
    if (flags.list) {
      await this.listPMOsAndHQs();
      return;
    }

    // Find source PMO
    const sourcePMO = await this.findSourcePMO(flags.from);
    if (!sourcePMO) {
      this.log(chalk.red('\nNo standalone PMO found.'));
      this.log(chalk.gray('\nStandalone PMOs are no longer supported.'));
      this.log(chalk.gray('Use "prlt init" to create an HQ with integrated PMO.\n'));
      return;
    }

    // Find target HQ
    const targetHQ = await this.findTargetHQ(flags.to);
    if (!targetHQ) {
      this.log(chalk.red('\nNo target HQ specified or found.'));
      this.log(chalk.gray('\nCreate an HQ first with "prlt init --name my-project"\n'));
      return;
    }

    // Show migration plan
    const { ticketCount, projectCount } = this.getMigrationStats(sourcePMO);

    this.log(chalk.blue('\n📦 PMO Migration\n'));
    this.log(chalk.gray(`  Source: ${sourcePMO}`));
    this.log(chalk.gray(`  Target: ${targetHQ}`));
    this.log(chalk.gray(`  Projects: ${projectCount}`));
    this.log(chalk.gray(`  Tickets: ${ticketCount}\n`));

    if (ticketCount === 0 && projectCount === 0) {
      this.log(chalk.yellow('No data to migrate.'));
      return;
    }

    // Confirm migration
    if (!flags.force) {
      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Proceed with migration?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
        default: true,
      }]);

      if (!confirm) {
        this.log(chalk.yellow('\nMigration cancelled.'));
        return;
      }
    }

    // Perform migration
    await this.migrate(sourcePMO, targetHQ);

    // Prompt to delete source
    if (!flags['keep-source']) {
      const { deleteSource } = await inquirer.prompt([{
        type: 'list',
        name: 'deleteSource',
        message: 'Delete the source PMO?',
        choices: [
          { name: 'Yes (recommended)', value: true },
          { name: 'No (keep for backup)', value: false },
        ],
        default: true,
      }]);

      if (deleteSource) {
        await this.deleteSourcePMO(sourcePMO);
      }
    }

    // Clean up global config reference
    await this.cleanupGlobalConfig();

    this.log(chalk.green('\n✅ Migration complete!\n'));
    this.log(chalk.gray('Next steps:'));
    this.log(chalk.gray(`  cd ${targetHQ}`));
    this.log(chalk.gray('  prlt ticket list'));
  }

  private async listPMOsAndHQs(): Promise<void> {
    this.log(chalk.blue('\n📋 Available PMOs and HQs\n'));

    // Find standalone PMOs
    const standalonePMOs = this.findStandalonePMOs();
    if (standalonePMOs.length > 0) {
      this.log(chalk.yellow('Standalone PMOs (need migration):'));
      for (const pmo of standalonePMOs) {
        const stats = this.getMigrationStats(pmo);
        this.log(chalk.gray(`  • ${pmo} (${stats.projectCount} projects, ${stats.ticketCount} tickets)`));
      }
      this.log('');
    } else {
      this.log(chalk.green('No standalone PMOs found.\n'));
    }

    // Find HQs
    const hqs = this.findAllHQs();
    if (hqs.length > 0) {
      this.log(chalk.cyan('Available HQs:'));
      for (const hq of hqs) {
        const hasPMO = this.hasPMOTables(path.join(hq.path, '.proletariat', 'workspace.db'));
        const pmoStatus = hasPMO ? '(has PMO)' : '(no PMO)';
        this.log(chalk.gray(`  • ${hq.name}: ${hq.path} ${pmoStatus}`));
      }
    } else {
      this.log(chalk.gray('No HQs found. Create one with "prlt init"'));
    }
    this.log('');
  }

  private async findSourcePMO(flagPath?: string): Promise<string | null> {
    // If path specified, use it
    if (flagPath) {
      const resolved = path.resolve(flagPath);
      if (this.isStandalonePMO(resolved)) {
        return resolved;
      }
      this.log(chalk.yellow(`Warning: ${flagPath} is not a valid standalone PMO`));
      return null;
    }

    // Auto-detect: check current directory for .pmo
    const cwdPMO = path.join(process.cwd(), '.pmo');
    if (this.isStandalonePMO(cwdPMO)) {
      return cwdPMO;
    }

    // Check global config for defaultPMO
    const machineConfig = this.getMachineConfig();
    if (machineConfig?.defaultPMO) {
      const defaultPMODir = path.dirname(machineConfig.defaultPMO);
      if (this.isStandalonePMO(defaultPMODir)) {
        return defaultPMODir;
      }
    }

    // Search up directory tree
    let currentDir = process.cwd();
    while (currentDir !== '/' && currentDir !== path.dirname(currentDir)) {
      const pmoPath = path.join(currentDir, '.pmo');
      if (this.isStandalonePMO(pmoPath)) {
        return pmoPath;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  private async findTargetHQ(flagPath?: string): Promise<string | null> {
    // If path specified, resolve it
    if (flagPath) {
      // Check if it's a name or path
      if (!flagPath.includes('/') && !flagPath.includes('\\')) {
        // It's a name - look it up in machine config
        const hqs = this.findAllHQs();
        const match = hqs.find(hq => hq.name === flagPath || hq.name === `${flagPath}-hq`);
        if (match) {
          return match.path;
        }

        // Try common locations
        const commonPaths = [
          path.join(process.cwd(), flagPath),
          path.join(process.cwd(), `${flagPath}-hq`),
          path.join(os.homedir(), flagPath),
          path.join(os.homedir(), `${flagPath}-hq`),
        ];

        for (const p of commonPaths) {
          if (isValidHQ(p)) {
            return p;
          }
        }

        this.log(chalk.yellow(`Could not find HQ: ${flagPath}`));
        return null;
      }

      // It's a path
      const resolved = path.resolve(flagPath);
      if (isValidHQ(resolved)) {
        return resolved;
      }
      this.log(chalk.yellow(`Not a valid HQ: ${resolved}`));
      return null;
    }

    // Auto-detect: check if we're in an HQ
    const hqRoot = findHQRoot();
    if (hqRoot) {
      return hqRoot;
    }

    // Check machine config for active workspace
    const machineConfig = this.getMachineConfig();
    const activeHQ = machineConfig?.headquarters?.[0]?.path || machineConfig?.workspaces?.[0]?.path;
    if (activeHQ && isValidHQ(activeHQ)) {
      return activeHQ;
    }

    // Prompt user to select from available HQs
    const hqs = this.findAllHQs();
    if (hqs.length === 0) {
      return null;
    }

    if (hqs.length === 1) {
      return hqs[0].path;
    }

    const { selectedHQ } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedHQ',
      message: 'Select target HQ:',
      choices: hqs.map(hq => ({
        name: `${hq.name} (${hq.path})`,
        value: hq.path,
      })),
    }]);

    return selectedHQ;
  }

  private isStandalonePMO(pmoPath: string): boolean {
    const dbPath = path.join(pmoPath, '.proletariat', 'workspace.db');
    return this.hasPMOTables(dbPath);
  }

  private hasPMOTables(dbPath: string): boolean {
    if (!fs.existsSync(dbPath)) {
      return false;
    }

    try {
      const db = new Database(dbPath);
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
      ).get();
      db.close();
      return result !== undefined;
    } catch {
      return false;
    }
  }

  private getMigrationStats(pmoPath: string): { ticketCount: number; projectCount: number } {
    const dbPath = path.join(pmoPath, '.proletariat', 'workspace.db');
    if (!fs.existsSync(dbPath)) {
      return { ticketCount: 0, projectCount: 0 };
    }

    try {
      const db = new Database(dbPath);
      const ticketResult = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number };
      const projectResult = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number };
      db.close();
      return {
        ticketCount: ticketResult.count,
        projectCount: projectResult.count,
      };
    } catch {
      return { ticketCount: 0, projectCount: 0 };
    }
  }

  private getMachineConfig(): MachineConfig | null {
    const configPath = path.join(os.homedir(), '.proletariat', 'config.json');
    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private findStandalonePMOs(): string[] {
    const pmos: string[] = [];

    // Check current directory
    const cwdPMO = path.join(process.cwd(), '.pmo');
    if (this.isStandalonePMO(cwdPMO)) {
      pmos.push(cwdPMO);
    }

    // Check global config for defaultPMO
    const machineConfig = this.getMachineConfig();
    if (machineConfig?.defaultPMO) {
      const defaultPMODir = path.dirname(machineConfig.defaultPMO);
      if (this.isStandalonePMO(defaultPMODir) && !pmos.includes(defaultPMODir)) {
        pmos.push(defaultPMODir);
      }
    }

    return pmos;
  }

  private findAllHQs(): Array<{ name: string; path: string }> {
    const hqs: Array<{ name: string; path: string }> = [];

    // Check machine config
    const machineConfig = this.getMachineConfig();
    const registered = machineConfig?.headquarters || machineConfig?.workspaces || [];

    for (const entry of registered) {
      if (isValidHQ(entry.path)) {
        hqs.push(entry);
      }
    }

    return hqs;
  }

  private async migrate(sourcePath: string, targetPath: string): Promise<void> {
    this.log(chalk.blue('\nMigrating data...\n'));

    const sourceDbPath = path.join(sourcePath, '.proletariat', 'workspace.db');
    const targetDbPath = path.join(targetPath, '.proletariat', 'workspace.db');

    const sourceDb = new Database(sourceDbPath);
    const targetDb = new Database(targetDbPath);

    try {
      // Get source projects
      const projects = sourceDb.prepare('SELECT * FROM pmo_projects').all() as ProjectRow[];
      this.log(chalk.gray(`  Migrating ${projects.length} project(s)...`));

      for (const project of projects) {
        // Check if project already exists in target
        const existing = targetDb.prepare('SELECT id FROM pmo_projects WHERE id = ?').get(project.id);
        if (existing) {
          this.log(chalk.yellow(`    Skipping project "${project.id}" (already exists)`));
          continue;
        }

        // Insert project
        targetDb.prepare(`
          INSERT INTO pmo_projects (id, name, description, template, created_at, updated_at, workflow_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          project.id,
          project.name,
          project.description,
          project.template,
          project.created_at,
          project.updated_at,
          project.workflow_id
        );
        this.log(chalk.green(`    ✓ Migrated project: ${project.id}`));
      }

      // Get source workflows and statuses
      const workflows = sourceDb.prepare('SELECT * FROM pmo_workflows').all() as Array<{ id: string; name: string; is_builtin: number }>;
      for (const workflow of workflows) {
        const existing = targetDb.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get(workflow.id);
        if (!existing) {
          targetDb.prepare(`
            INSERT INTO pmo_workflows (id, name, is_builtin)
            VALUES (?, ?, ?)
          `).run(workflow.id, workflow.name, workflow.is_builtin);
        }
      }

      const statuses = sourceDb.prepare('SELECT * FROM pmo_workflow_statuses').all() as StatusRow[];
      for (const status of statuses) {
        const existing = targetDb.prepare('SELECT id FROM pmo_workflow_statuses WHERE id = ?').get(status.id);
        if (!existing) {
          targetDb.prepare(`
            INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(status.id, status.workflow_id, status.name, status.category, status.position, status.is_default);
        }
      }

      // Get source tickets
      const tickets = sourceDb.prepare('SELECT * FROM pmo_tickets').all() as TicketRow[];
      this.log(chalk.gray(`  Migrating ${tickets.length} ticket(s)...`));

      for (const ticket of tickets) {
        // Check if ticket already exists in target
        const existing = targetDb.prepare('SELECT id FROM pmo_tickets WHERE id = ?').get(ticket.id);
        if (existing) {
          this.log(chalk.yellow(`    Skipping ticket "${ticket.id}" (already exists)`));
          continue;
        }

        // Insert ticket
        targetDb.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, description, priority, category, status_id, owner, assignee, spec_id, epic_id, labels, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ticket.id,
          ticket.project_id,
          ticket.title,
          ticket.description,
          ticket.priority,
          ticket.category,
          ticket.status_id,
          ticket.owner,
          ticket.assignee,
          ticket.spec_id,
          ticket.epic_id,
          ticket.labels,
          ticket.created_at,
          ticket.updated_at
        );
        this.log(chalk.green(`    ✓ Migrated ticket: ${ticket.id}`));
      }

      // Migrate related data (subtasks, acceptance criteria, etc.)
      await this.migrateRelatedData(sourceDb, targetDb);

      this.log(chalk.green('\n  Migration complete!'));
    } finally {
      sourceDb.close();
      targetDb.close();
    }
  }

  private async migrateRelatedData(sourceDb: Database.Database, targetDb: Database.Database): Promise<void> {
    // Migrate subtasks
    try {
      const subtasks = sourceDb.prepare('SELECT * FROM pmo_subtasks').all() as Array<Record<string, unknown>>;
      for (const subtask of subtasks) {
        const existing = targetDb.prepare('SELECT id FROM pmo_subtasks WHERE id = ?').get(subtask.id);
        if (!existing) {
          const columns = Object.keys(subtask).join(', ');
          const placeholders = Object.keys(subtask).map(() => '?').join(', ');
          targetDb.prepare(`INSERT INTO pmo_subtasks (${columns}) VALUES (${placeholders})`).run(...Object.values(subtask));
        }
      }
      if (subtasks.length > 0) {
        this.log(chalk.gray(`    Migrated ${subtasks.length} subtask(s)`));
      }
    } catch {
      // Table might not exist
    }

    // Migrate acceptance criteria
    try {
      const acs = sourceDb.prepare('SELECT * FROM pmo_ticket_acceptance_criteria').all() as Array<Record<string, unknown>>;
      for (const ac of acs) {
        const existing = targetDb.prepare('SELECT id FROM pmo_ticket_acceptance_criteria WHERE id = ?').get(ac.id);
        if (!existing) {
          const columns = Object.keys(ac).join(', ');
          const placeholders = Object.keys(ac).map(() => '?').join(', ');
          targetDb.prepare(`INSERT INTO pmo_ticket_acceptance_criteria (${columns}) VALUES (${placeholders})`).run(...Object.values(ac));
        }
      }
      if (acs.length > 0) {
        this.log(chalk.gray(`    Migrated ${acs.length} acceptance criteria`));
      }
    } catch {
      // Table might not exist
    }

    // Migrate epics
    try {
      const epics = sourceDb.prepare('SELECT * FROM pmo_epics').all() as Array<Record<string, unknown>>;
      for (const epic of epics) {
        const existing = targetDb.prepare('SELECT id FROM pmo_epics WHERE id = ?').get(epic.id);
        if (!existing) {
          const columns = Object.keys(epic).join(', ');
          const placeholders = Object.keys(epic).map(() => '?').join(', ');
          targetDb.prepare(`INSERT INTO pmo_epics (${columns}) VALUES (${placeholders})`).run(...Object.values(epic));
        }
      }
      if (epics.length > 0) {
        this.log(chalk.gray(`    Migrated ${epics.length} epic(s)`));
      }
    } catch {
      // Table might not exist
    }

    // Migrate specs
    try {
      const specs = sourceDb.prepare('SELECT * FROM pmo_specs').all() as Array<Record<string, unknown>>;
      for (const spec of specs) {
        const existing = targetDb.prepare('SELECT id FROM pmo_specs WHERE id = ?').get(spec.id);
        if (!existing) {
          const columns = Object.keys(spec).join(', ');
          const placeholders = Object.keys(spec).map(() => '?').join(', ');
          targetDb.prepare(`INSERT INTO pmo_specs (${columns}) VALUES (${placeholders})`).run(...Object.values(spec));
        }
      }
      if (specs.length > 0) {
        this.log(chalk.gray(`    Migrated ${specs.length} spec(s)`));
      }
    } catch {
      // Table might not exist
    }
  }

  private async deleteSourcePMO(sourcePath: string): Promise<void> {
    this.log(chalk.blue('\nDeleting source PMO...'));
    try {
      fs.rmSync(sourcePath, { recursive: true, force: true });
      this.log(chalk.green('  ✓ Source PMO deleted'));
    } catch (error) {
      this.log(chalk.yellow(`  ⚠ Could not delete source: ${error}`));
    }
  }

  private async cleanupGlobalConfig(): Promise<void> {
    const configPath = path.join(os.homedir(), '.proletariat', 'config.json');
    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.defaultPMO) {
        delete config.defaultPMO;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        this.log(chalk.gray('  Cleaned up global config (removed defaultPMO)'));
      }
    } catch {
      // Ignore errors
    }
  }
}
