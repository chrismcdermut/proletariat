import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { findAllHQs, isValidHQ, findHQRoot } from '../../lib/workspace.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';

// Use shared table names
const T = PMO_TABLES;

interface MergeStats {
  projects: number;
  tickets: number;
  specs: number;
  epics: number;
  subtasks: number;
  columns: number;
}

export default class WorkspaceMerge extends Command {
  static description = 'Merge tickets, specs, and projects from one workspace into another';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/source --into /path/to/target',
    '<%= config.bin %> <%= command.id %> /path/to/source  # Merge into current workspace',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static flags = {
    into: Flags.string({
      description: 'Target workspace to merge into (default: current workspace)',
    }),
    'delete-source': Flags.boolean({
      description: 'Delete source workspace after successful merge',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be merged without making changes',
      default: false,
    }),
  };

  static args = {
    source: Args.string({
      description: 'Source workspace path to merge from (optional - will prompt if not provided)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceMerge);

    // Determine source workspace
    let sourcePath: string;
    if (args.source) {
      sourcePath = path.resolve(args.source);
      if (!this.isValidWorkspaceWithPMO(sourcePath)) {
        this.log(chalk.red(`\nError: ${sourcePath} is not a valid workspace with PMO data.`));
        return;
      }
    } else {
      // Discover workspaces and prompt for selection
      const allHQs = findAllHQs(process.cwd());
      if (allHQs.length < 2) {
        this.log(chalk.yellow('Need at least 2 workspaces to merge.'));
        this.log(chalk.gray('Run "prlt workspace list" to see available workspaces.'));
        return;
      }

      const choices = await this.buildWorkspaceChoices(allHQs);
      const { selectedSource } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedSource',
        message: 'Select SOURCE workspace (data will be moved FROM here):',
        choices,
      }]);
      sourcePath = selectedSource;
    }

    // Determine target workspace
    let targetPath: string;
    if (flags.into) {
      targetPath = path.resolve(flags.into);
      if (!this.isValidWorkspaceWithPMO(targetPath)) {
        this.log(chalk.red(`\nError: ${targetPath} is not a valid workspace with PMO data.`));
        return;
      }
    } else {
      // Use current workspace as target, or prompt if source is current
      const currentHQ = findHQRoot();
      if (currentHQ && currentHQ !== sourcePath) {
        targetPath = currentHQ;
      } else {
        // Prompt for target
        const allHQs = findAllHQs(process.cwd()).filter(hq => hq !== sourcePath);
        if (allHQs.length === 0) {
          this.log(chalk.red('No other workspace available as merge target.'));
          return;
        }

        const choices = await this.buildWorkspaceChoices(allHQs);
        const { selectedTarget } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTarget',
          message: 'Select TARGET workspace (data will be moved INTO here):',
          choices,
        }]);
        targetPath = selectedTarget;
      }
    }

    // Prevent merging into self
    if (sourcePath === targetPath) {
      this.log(chalk.red('Source and target workspaces cannot be the same.'));
      return;
    }

    // Analyze what will be merged
    const sourceStats = this.analyzeWorkspace(sourcePath);
    const targetStats = this.analyzeWorkspace(targetPath);

    this.log(chalk.blue('\n📊 Merge Analysis\n'));
    this.log(chalk.white('Source workspace:'));
    this.log(chalk.gray(`  Path: ${sourcePath}`));
    this.logStats(sourceStats, '  ');

    this.log(chalk.white('\nTarget workspace:'));
    this.log(chalk.gray(`  Path: ${targetPath}`));
    this.logStats(targetStats, '  ');

    if (sourceStats.projects === 0 && sourceStats.tickets === 0 && sourceStats.specs === 0) {
      this.log(chalk.yellow('\nSource workspace has no data to merge.'));
      return;
    }

    if (flags['dry-run']) {
      this.log(chalk.cyan('\n[Dry Run] Would merge the above data. No changes made.'));
      return;
    }

    // Confirm merge
    const { confirmed } = await inquirer.prompt([{
      type: 'list',
      name: 'confirmed',
      message: `Merge ${sourceStats.tickets} tickets and ${sourceStats.specs} specs into target?`,
      choices: [
        { name: 'Yes, proceed with merge', value: true },
        { name: 'No, cancel', value: false },
      ],
      default: false,
    }]);

    if (!confirmed) {
      this.log(chalk.yellow('\nMerge cancelled.'));
      return;
    }

    // Perform merge
    this.log(chalk.blue('\n🔄 Merging workspaces...\n'));
    const merged = await this.performMerge(sourcePath, targetPath);

    this.log(chalk.green('\n✅ Merge completed successfully!\n'));
    this.log(chalk.white('Merged data:'));
    this.logStats(merged, '  ');

    // Delete source if requested
    if (flags['delete-source']) {
      const { confirmDelete } = await inquirer.prompt([{
        type: 'list',
        name: 'confirmDelete',
        message: `Delete source workspace at ${sourcePath}?`,
        choices: [
          { name: 'Yes, delete source', value: true },
          { name: 'No, keep source', value: false },
        ],
        default: false,
      }]);

      if (confirmDelete) {
        await this.deleteSourceWorkspace(sourcePath);
        this.log(chalk.green(`\n✓ Deleted source workspace: ${sourcePath}`));
      }
    } else {
      this.log(chalk.gray('\nSource workspace preserved. To delete it later:'));
      this.log(chalk.cyan(`  rm -rf "${sourcePath}"`));
    }
  }

  private isValidWorkspaceWithPMO(hqPath: string): boolean {
    if (!isValidHQ(hqPath)) {
      return false;
    }

    // Also check if it has a workspace.db with PMO tables
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (!fs.existsSync(dbPath)) {
      // Check for standalone .pmo structure
      const pmoDB = path.join(hqPath, '.pmo', '.proletariat', 'workspace.db');
      return fs.existsSync(pmoDB);
    }

    return true;
  }

  private async buildWorkspaceChoices(hqPaths: string[]): Promise<Array<{ name: string; value: string }>> {
    return hqPaths.map(hq => {
      const configPath = path.join(hq, '.proletariat', 'config.json');
      let name = path.basename(hq);
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.name) {
          name = config.name;
        }
      } catch {
        // Use basename
      }

      const stats = this.analyzeWorkspace(hq);
      return {
        name: `${name} (${stats.tickets} tickets, ${stats.specs} specs) - ${hq}`,
        value: hq,
      };
    });
  }

  private getDbPath(hqPath: string): string {
    // Check standard location first
    let dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }

    // Check standalone .pmo structure
    dbPath = path.join(hqPath, '.pmo', '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }

    // Try just the path as is (might be a direct path to workspace.db)
    return path.join(hqPath, '.proletariat', 'workspace.db');
  }

  private analyzeWorkspace(hqPath: string): MergeStats {
    const dbPath = this.getDbPath(hqPath);
    if (!fs.existsSync(dbPath)) {
      return { projects: 0, tickets: 0, specs: 0, epics: 0, subtasks: 0, columns: 0 };
    }

    try {
      const db = new Database(dbPath);
      const stats: MergeStats = { projects: 0, tickets: 0, specs: 0, epics: 0, subtasks: 0, columns: 0 };

      // Count entities (with try/catch for each in case table doesn't exist)
      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.projects}`).get() as { count: number };
        stats.projects = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.tickets}`).get() as { count: number };
        stats.tickets = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.specs}`).get() as { count: number };
        stats.specs = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.epics}`).get() as { count: number };
        stats.epics = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.subtasks}`).get() as { count: number };
        stats.subtasks = result.count;
      } catch { /* table might not exist */ }

      try {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${T.columns}`).get() as { count: number };
        stats.columns = result.count;
      } catch { /* table might not exist */ }

      db.close();
      return stats;
    } catch {
      return { projects: 0, tickets: 0, specs: 0, epics: 0, subtasks: 0, columns: 0 };
    }
  }

  private logStats(stats: MergeStats, indent: string): void {
    this.log(chalk.gray(`${indent}Projects: ${stats.projects}`));
    this.log(chalk.gray(`${indent}Tickets: ${stats.tickets}`));
    this.log(chalk.gray(`${indent}Specs: ${stats.specs}`));
    this.log(chalk.gray(`${indent}Epics: ${stats.epics}`));
    this.log(chalk.gray(`${indent}Subtasks: ${stats.subtasks}`));
  }

  private async performMerge(sourcePath: string, targetPath: string): Promise<MergeStats> {
    const sourceDbPath = this.getDbPath(sourcePath);
    const targetDbPath = this.getDbPath(targetPath);

    const sourceDb = new Database(sourceDbPath);
    const targetDb = new Database(targetDbPath);

    const merged: MergeStats = { projects: 0, tickets: 0, specs: 0, epics: 0, subtasks: 0, columns: 0 };

    // ID mapping for remapping foreign keys
    const projectIdMap = new Map<string, string>();
    const ticketIdMap = new Map<string, string>();
    const specIdMap = new Map<string, string>();
    const epicIdMap = new Map<string, string>();
    const columnIdMap = new Map<string, string>(); // key: "project_id:column_id" -> new column_id

    try {
      // 1. Merge projects (need to handle ID conflicts)
      const sourceProjects = this.safeQuery(sourceDb, `SELECT * FROM ${T.projects}`) as Array<Record<string, unknown>>;
      for (const proj of sourceProjects) {
        const newId = this.generateUniqueId(targetDb, T.projects, proj.id as string);
        projectIdMap.set(proj.id as string, newId);

        const columns = Object.keys(proj).filter(k => k !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => proj[k]);

        targetDb.prepare(`
          INSERT INTO ${T.projects} (id, ${columns.join(', ')})
          VALUES (?, ${placeholders})
        `).run(newId, ...values);

        merged.projects++;
        this.log(chalk.green(`  ✓ Merged project: ${proj.name}`));
      }

      // 2. Merge specs (global, not project-scoped)
      const sourceSpecs = this.safeQuery(sourceDb, `SELECT * FROM ${T.specs}`) as Array<Record<string, unknown>>;
      for (const spec of sourceSpecs) {
        const newId = this.generateUniqueId(targetDb, T.specs, spec.id as string);
        specIdMap.set(spec.id as string, newId);

        const columns = Object.keys(spec).filter(k => k !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => spec[k]);

        targetDb.prepare(`
          INSERT INTO ${T.specs} (id, ${columns.join(', ')})
          VALUES (?, ${placeholders})
        `).run(newId, ...values);

        merged.specs++;
        this.log(chalk.green(`  ✓ Merged spec: ${spec.title}`));
      }

      // 3. Merge columns (need to remap project_id)
      const sourceColumns = this.safeQuery(sourceDb, `SELECT * FROM ${T.columns}`) as Array<Record<string, unknown>>;
      for (const col of sourceColumns) {
        const oldProjectId = col.project_id as string;
        const newProjectId = projectIdMap.get(oldProjectId) || oldProjectId;

        // Check if this column already exists in target for this project
        const existing = targetDb.prepare(`
          SELECT id FROM ${T.columns} WHERE project_id = ? AND name = ?
        `).get(newProjectId, col.name);

        if (existing) {
          // Map to existing column
          columnIdMap.set(`${oldProjectId}:${col.id}`, (existing as { id: string }).id);
        } else {
          // Create new column
          const newColId = col.id as string; // columns usually have deterministic IDs
          columnIdMap.set(`${oldProjectId}:${col.id}`, newColId);

          targetDb.prepare(`
            INSERT OR IGNORE INTO ${T.columns} (id, project_id, name, position, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(newColId, newProjectId, col.name, col.position, col.created_at);

          merged.columns++;
        }
      }

      // 4. Merge epics (need to remap project_id and spec_id)
      const sourceEpics = this.safeQuery(sourceDb, `SELECT * FROM ${T.epics}`) as Array<Record<string, unknown>>;
      for (const epic of sourceEpics) {
        const newId = this.generateUniqueId(targetDb, T.epics, epic.id as string);
        epicIdMap.set(epic.id as string, newId);

        const oldProjectId = epic.project_id as string;
        const newProjectId = projectIdMap.get(oldProjectId) || oldProjectId;
        const oldSpecId = epic.spec_id as string | null;
        const newSpecId = oldSpecId ? (specIdMap.get(oldSpecId) || oldSpecId) : null;

        const columns = Object.keys(epic).filter(k => k !== 'id' && k !== 'project_id' && k !== 'spec_id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => epic[k]);

        targetDb.prepare(`
          INSERT INTO ${T.epics} (id, project_id, spec_id, ${columns.join(', ')})
          VALUES (?, ?, ?, ${placeholders})
        `).run(newId, newProjectId, newSpecId, ...values);

        merged.epics++;
      }

      // 5. Merge tickets (need to remap project_id, spec_id, epic_id)
      const sourceTickets = this.safeQuery(sourceDb, `SELECT * FROM ${T.tickets}`) as Array<Record<string, unknown>>;
      for (const ticket of sourceTickets) {
        const newId = this.generateUniqueTicketId(targetDb, ticket.id as string);
        ticketIdMap.set(ticket.id as string, newId);

        const oldProjectId = ticket.project_id as string;
        const newProjectId = projectIdMap.get(oldProjectId) || oldProjectId;
        const oldSpecId = ticket.spec_id as string | null;
        const newSpecId = oldSpecId ? (specIdMap.get(oldSpecId) || oldSpecId) : null;
        const oldEpicId = ticket.epic_id as string | null;
        const newEpicId = oldEpicId ? (epicIdMap.get(oldEpicId) || oldEpicId) : null;

        const columns = Object.keys(ticket).filter(k =>
          k !== 'id' && k !== 'project_id' && k !== 'spec_id' && k !== 'epic_id'
        );
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => ticket[k]);

        targetDb.prepare(`
          INSERT INTO ${T.tickets} (id, project_id, spec_id, epic_id, ${columns.join(', ')})
          VALUES (?, ?, ?, ?, ${placeholders})
        `).run(newId, newProjectId, newSpecId, newEpicId, ...values);

        merged.tickets++;
        this.log(chalk.green(`  ✓ Merged ticket: ${newId} - ${ticket.title}`));
      }

      // 6. Merge subtasks (need to remap ticket_id)
      const sourceSubtasks = this.safeQuery(sourceDb, `SELECT * FROM ${T.subtasks}`) as Array<Record<string, unknown>>;
      for (const subtask of sourceSubtasks) {
        const oldTicketId = subtask.ticket_id as string;
        const newTicketId = ticketIdMap.get(oldTicketId);
        if (!newTicketId) continue; // Skip orphaned subtasks

        const columns = Object.keys(subtask).filter(k => k !== 'ticket_id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => subtask[k]);

        targetDb.prepare(`
          INSERT INTO ${T.subtasks} (ticket_id, ${columns.join(', ')})
          VALUES (?, ${placeholders})
        `).run(newTicketId, ...values);

        merged.subtasks++;
      }

      // 7. Merge ticket_specs join table
      const sourceTicketSpecs = this.safeQuery(sourceDb, `SELECT * FROM ${T.ticket_specs}`) as Array<Record<string, unknown>>;
      for (const ts of sourceTicketSpecs) {
        const newTicketId = ticketIdMap.get(ts.ticket_id as string);
        const newSpecId = specIdMap.get(ts.spec_id as string);
        if (!newTicketId || !newSpecId) continue;

        targetDb.prepare(`
          INSERT OR IGNORE INTO ${T.ticket_specs} (ticket_id, spec_id)
          VALUES (?, ?)
        `).run(newTicketId, newSpecId);
      }

      // 8. Merge board_tickets (need to remap project_id, ticket_id, column_id)
      const sourceBoardTickets = this.safeQuery(sourceDb, `SELECT * FROM ${T.board_tickets}`) as Array<Record<string, unknown>>;
      for (const bt of sourceBoardTickets) {
        const oldProjectId = bt.project_id as string;
        const newProjectId = projectIdMap.get(oldProjectId) || oldProjectId;
        const newTicketId = ticketIdMap.get(bt.ticket_id as string);
        const newColumnId = columnIdMap.get(`${oldProjectId}:${bt.column_id}`);
        if (!newTicketId || !newColumnId) continue;

        targetDb.prepare(`
          INSERT OR IGNORE INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
          VALUES (?, ?, ?, ?)
        `).run(newProjectId, newTicketId, newColumnId, bt.position);
      }

      // 9. Merge ticket_assignments (need to remap ticket_id)
      const sourceAssignments = this.safeQuery(sourceDb, `SELECT * FROM ${T.ticket_assignments}`) as Array<Record<string, unknown>>;
      for (const assign of sourceAssignments) {
        const newTicketId = ticketIdMap.get(assign.ticket_id as string);
        if (!newTicketId) continue;

        targetDb.prepare(`
          INSERT OR IGNORE INTO ${T.ticket_assignments} (ticket_id, agent_name, assigned_at)
          VALUES (?, ?, ?)
        `).run(newTicketId, assign.agent_name, assign.assigned_at);
      }

      // 10. Merge project_specs (need to remap project_id, spec_id)
      const sourceProjectSpecs = this.safeQuery(sourceDb, `SELECT * FROM ${T.project_specs}`) as Array<Record<string, unknown>>;
      for (const ps of sourceProjectSpecs) {
        const newProjectId = projectIdMap.get(ps.project_id as string);
        const newSpecId = specIdMap.get(ps.spec_id as string);
        if (!newProjectId || !newSpecId) continue;

        targetDb.prepare(`
          INSERT OR IGNORE INTO ${T.project_specs} (project_id, spec_id, created_at)
          VALUES (?, ?, ?)
        `).run(newProjectId, newSpecId, ps.created_at);
      }

    } finally {
      sourceDb.close();
      targetDb.close();
    }

    return merged;
  }

  private safeQuery(db: Database.Database, sql: string): unknown[] {
    try {
      return db.prepare(sql).all();
    } catch {
      return [];
    }
  }

  private generateUniqueId(db: Database.Database, table: string, preferredId: string): string {
    // Check if ID already exists
    const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(preferredId);
    if (!existing) {
      return preferredId;
    }

    // Generate a new unique ID with suffix
    let counter = 1;
    let newId = `${preferredId}-merged-${counter}`;
    while (db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(newId)) {
      counter++;
      newId = `${preferredId}-merged-${counter}`;
    }
    return newId;
  }

  private generateUniqueTicketId(db: Database.Database, preferredId: string): string {
    // Ticket IDs follow pattern TKT-NNN, need special handling
    const existing = db.prepare(`SELECT id FROM ${T.tickets} WHERE id = ?`).get(preferredId);
    if (!existing) {
      return preferredId;
    }

    // Find highest ticket number and increment
    const result = db.prepare(`
      SELECT id FROM ${T.tickets}
      WHERE id LIKE 'TKT-%'
      ORDER BY CAST(SUBSTR(id, 5) AS INTEGER) DESC
      LIMIT 1
    `).get() as { id: string } | undefined;

    if (result) {
      const match = result.id.match(/TKT-(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        return `TKT-${String(nextNum).padStart(3, '0')}`;
      }
    }

    // Fallback: add suffix
    return `${preferredId}-merged`;
  }

  private async deleteSourceWorkspace(sourcePath: string): Promise<void> {
    // Check if it's a standalone .pmo - only delete the .pmo folder
    const dotPmoPath = path.join(sourcePath, '.pmo');
    if (fs.existsSync(dotPmoPath) && sourcePath.endsWith('.pmo')) {
      fs.rmSync(sourcePath, { recursive: true, force: true });
    } else if (fs.existsSync(dotPmoPath)) {
      // Delete just the .pmo folder, not the whole directory
      fs.rmSync(dotPmoPath, { recursive: true, force: true });
    } else {
      // It's a full HQ - delete the .proletariat folder and pmo folder
      const proletariatPath = path.join(sourcePath, '.proletariat');
      if (fs.existsSync(proletariatPath)) {
        fs.rmSync(proletariatPath, { recursive: true, force: true });
      }
      const pmoPath = path.join(sourcePath, 'pmo');
      if (fs.existsSync(pmoPath)) {
        fs.rmSync(pmoPath, { recursive: true, force: true });
      }
    }
  }
}
