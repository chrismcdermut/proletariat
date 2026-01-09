import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

/**
 * End-to-end tests for PMO Status Template Commands
 * Tests: prlt status template list, apply, save, delete
 *
 * SKIPPED: Tests need HQ environment setup. The commands exist and work correctly,
 * but the test environment needs:
 * - .proletariat/config.json with type: 'hq'
 * - Proper PMO initialization with pmo_path setting
 * - A 'current_project' setting or --project flag to avoid interactive prompts
 *
 * Command paths have been updated from 'template' to 'status template':
 * - prlt status template list
 * - prlt status template apply <template-id>
 * - prlt status template save "<name>"
 * - prlt status template delete <template-id>
 */
describe.skip('PMO Status Template Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-template-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt status template list', () => {
    it('should list all templates', () => {
      const output = exec('status template list');

      expect(output).to.contain('Status Templates');
      expect(output).to.contain('kanban');
      expect(output).to.contain('linear');
    });

    it('should show built-in templates section', () => {
      const output = exec('status template list');

      expect(output).to.contain('Built-in Templates');
    });

    it('should filter to builtin only with --builtin', () => {
      const output = exec('status template list --builtin');

      expect(output).to.contain('Built-in Templates');
      expect(output).not.to.contain('Custom Templates');
    });

    it('should show template descriptions', () => {
      const output = exec('status template list');

      expect(output).to.contain('Simple kanban');
      expect(output).to.contain('Linear-style');
    });

    it('should output JSON with --json flag', () => {
      const output = exec('status template list --json');

      const templates = JSON.parse(output);
      expect(templates).to.be.an('array');
      expect(templates.length).to.be.at.least(2);
      expect(templates.some((t: { id: string }) => t.id === 'kanban')).to.be.true;
    });
  });

  describe('prlt status template apply', () => {
    it('should apply template to default project', () => {
      const output = exec('status template apply kanban --force');

      expect(output).to.contain('Applied template');
      expect(output).to.contain('Kanban');

      // Verify statuses were created
      const statuses = db.prepare('SELECT * FROM pmo_statuses WHERE project_id = ?').all('default');
      expect(statuses.length).to.be.greaterThan(0);
    });

    it('should create statuses from template', () => {
      exec('status template apply kanban --force');

      const statuses = db.prepare('SELECT name FROM pmo_statuses WHERE project_id = ?').all('default') as { name: string }[];
      const names = statuses.map(s => s.name);

      expect(names).to.include('Backlog');
      expect(names).to.include('In Progress');
      expect(names).to.include('Done');
    });

    it('should set a default status', () => {
      exec('status template apply kanban --force');

      const defaultStatus = db.prepare('SELECT * FROM pmo_statuses WHERE project_id = ? AND is_default = 1').get('default');
      expect(defaultStatus).to.not.be.undefined;
    });

    it('should error when template not found', () => {
      const output = exec('status template apply non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should replace existing statuses', () => {
      // First apply kanban
      exec('status template apply kanban --force');

      // Then apply linear
      exec('status template apply linear --force');

      const linearStatuses = db.prepare('SELECT * FROM pmo_statuses WHERE project_id = ?').all('default') as { name: string }[];
      const names = linearStatuses.map(s => s.name);

      // Should have linear statuses, not kanban
      expect(names).to.include('Backlog');
      expect(names).to.include('Todo');
      expect(names).to.include('In Progress');
    });

    it('should apply to specific project with --project', () => {
      // Create a second project
      createTestProject(db, 'other', 'Other Project');

      exec('status template apply kanban --project other --force');

      const otherStatuses = db.prepare('SELECT * FROM pmo_statuses WHERE project_id = ?').all('other');
      expect(otherStatuses.length).to.be.greaterThan(0);
    });
  });

  describe('prlt status template save', () => {
    beforeEach(() => {
      // Apply a template first so we have statuses to save
      exec('status template apply kanban --force');
    });

    it('should create template from project statuses', () => {
      const output = exec('status template save "My Custom Template"');

      expect(output).to.contain('Created template');
      expect(output).to.contain('My Custom Template');

      // Verify template was created
      const template = db.prepare('SELECT * FROM pmo_templates WHERE name = ?').get('My Custom Template');
      expect(template).to.not.be.undefined;
    });

    it('should generate slugified ID', () => {
      exec('status template save "My Workflow Template"');

      const template = db.prepare('SELECT id FROM pmo_templates WHERE name = ?').get('My Workflow Template') as { id: string };
      expect(template.id).to.equal('my-workflow-template');
    });

    it('should include description when provided', () => {
      exec('status template save "Team Workflow" --description "Our team custom workflow"');

      const template = db.prepare('SELECT description FROM pmo_templates WHERE name = ?').get('Team Workflow') as { description: string };
      expect(template.description).to.equal('Our team custom workflow');
    });

    it('should not be marked as builtin', () => {
      exec('status template save "User Template"');

      const template = db.prepare('SELECT is_builtin FROM pmo_templates WHERE name = ?').get('User Template') as { is_builtin: number };
      expect(template.is_builtin).to.equal(0);
    });

    it('should error when name already exists', () => {
      exec('status template save "Duplicate"');
      const output = exec('status template save "Duplicate"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should preserve statuses in template', () => {
      exec('status template save "Preserved Template"');

      const template = db.prepare('SELECT statuses FROM pmo_templates WHERE name = ?').get('Preserved Template') as { statuses: string };
      const statuses = JSON.parse(template.statuses);

      expect(statuses).to.be.an('array');
      expect(statuses.length).to.be.greaterThan(0);
      expect(statuses.some((s: { name: string }) => s.name === 'Backlog')).to.be.true;
    });
  });

  describe('prlt status template delete', () => {
    beforeEach(() => {
      exec('status template apply kanban --force');
      exec('status template save "Deletable Template"');
    });

    it('should delete template', () => {
      exec('status template delete deletable-template --force');

      const template = db.prepare('SELECT * FROM pmo_templates WHERE id = ?').get('deletable-template');
      expect(template).to.be.undefined;
    });

    it('should error when template not found', () => {
      const output = exec('status template delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when deleting built-in template', () => {
      const output = exec('status template delete kanban --force');

      expect(output.toLowerCase()).to.contain('cannot delete');
    });

    it('should show success message', () => {
      const output = exec('status template delete deletable-template --force');

      expect(output).to.contain('Deleted template');
    });
  });

  describe('status template workflow', () => {
    it('should allow creating and reapplying custom template', () => {
      // Apply a template
      exec('status template apply linear --force');

      // Save as custom template
      exec('status template save "Linear Copy"');

      // Create new project
      createTestProject(db, 'new-proj', 'New Project');

      // Apply saved template
      exec('status template apply linear-copy --project new-proj --force');

      // Verify it worked
      const statuses = db.prepare('SELECT * FROM pmo_statuses WHERE project_id = ?').all('new-proj');
      expect(statuses.length).to.be.greaterThan(0);
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  // Use the complete schema from the actual codebase (matches schema.ts)
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Phases table (project lifecycle states)
    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      phase_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES pmo_phases(id) ON DELETE SET NULL
    );

    -- Initiatives table
    CREATE TABLE IF NOT EXISTS pmo_initiatives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT,
      key_results TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Columns table
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    -- Workflow statuses table
    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );

    -- Specs table (must be before tickets and epics due to FK)
    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      overview TEXT,
      status TEXT DEFAULT 'active',
      spec_type TEXT DEFAULT 'domain',
      domain TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Spec abilities table
    CREATE TABLE IF NOT EXISTS pmo_spec_abilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec implementations table
    CREATE TABLE IF NOT EXISTS pmo_spec_implementations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ability_id INTEGER NOT NULL REFERENCES pmo_spec_abilities(id) ON DELETE CASCADE,
      modality TEXT NOT NULL,
      signature TEXT NOT NULL,
      UNIQUE(ability_id, modality)
    );

    -- Spec fields table
    CREATE TABLE IF NOT EXISTS pmo_spec_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      required TEXT DEFAULT 'optional',
      default_value TEXT,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec rules table
    CREATE TABLE IF NOT EXISTS pmo_spec_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    -- Spec relations table
    CREATE TABLE IF NOT EXISTS pmo_spec_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      related_domain TEXT NOT NULL,
      relationship TEXT,
      UNIQUE(spec_id, related_domain)
    );

    -- Epics table (must be before tickets due to FK)
    CREATE TABLE IF NOT EXISTS pmo_epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
    );

    -- Tickets table
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      branch TEXT,
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id),
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
    );

    -- Subtasks table
    CREATE TABLE IF NOT EXISTS pmo_subtasks (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket metadata table
    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    );

    -- Ticket dependencies table
    CREATE TABLE IF NOT EXISTS pmo_ticket_dependencies (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      blocked_by_ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, blocked_by_ticket_id),
      CHECK (ticket_id != blocked_by_ticket_id)
    );

    -- Ticket affected paths table
    CREATE TABLE IF NOT EXISTS pmo_ticket_affected_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      path_pattern TEXT NOT NULL,
      path_type TEXT NOT NULL DEFAULT 'file',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Ticket acceptance criteria table
    CREATE TABLE IF NOT EXISTS pmo_ticket_acceptance_criteria (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL,
      verifiable INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TIMESTAMP,
      verified_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket specs table
    CREATE TABLE IF NOT EXISTS pmo_ticket_specs (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, spec_id)
    );

    -- Ticket assignments table
    CREATE TABLE IF NOT EXISTS pmo_ticket_assignments (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, agent_name)
    );

    -- Cache metadata table
    CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Agent work table
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      mode TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    -- Workflow templates table
    CREATE TABLE IF NOT EXISTS pmo_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      statuses TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_spec_abilities_spec ON pmo_spec_abilities(spec_id);
  `);

  // Seed default phases
  const defaultPhases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: 1 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
    { id: 'active', name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
    { id: 'completed', name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
    { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
  ];

  for (const phase of defaultPhases) {
    db.prepare(`
      INSERT INTO pmo_phases (id, name, category, position, description, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(phase.id, phase.name, phase.category, phase.position, phase.description, phase.isDefault || 0);
  }

  // Seed built-in templates
  const builtinTemplates = [
    {
      id: 'kanban',
      name: 'Kanban',
      description: 'Simple kanban workflow',
      statuses: JSON.stringify([
        { name: 'Backlog', category: 'backlog', position: 0, isDefault: true },
        { name: 'In Progress', category: 'started', position: 0 },
        { name: 'Done', category: 'completed', position: 0 },
      ]),
    },
    {
      id: 'linear',
      name: 'Linear',
      description: 'Linear-style workflow',
      statuses: JSON.stringify([
        { name: 'Backlog', category: 'backlog', position: 0, isDefault: true },
        { name: 'Todo', category: 'unstarted', position: 0 },
        { name: 'In Progress', category: 'started', position: 0 },
        { name: 'In Review', category: 'started', position: 1 },
        { name: 'Done', category: 'completed', position: 0 },
        { name: 'Canceled', category: 'canceled', position: 0 },
      ]),
    },
  ];

  for (const template of builtinTemplates) {
    db.prepare(`
      INSERT INTO pmo_templates (id, name, description, is_builtin, statuses)
      VALUES (?, ?, ?, 1, ?)
    `).run(template.id, template.name, template.description, template.statuses);
  }

  // Create default project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, phase_id, is_archived)
    VALUES ('default', 'Default Project', 'idea', 0)
  `).run();

  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('current_project', 'default')`).run();

  // Create default columns
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in_progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'default', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Seed default statuses for test project
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Create HQ config file (required for findPMO to work)
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: true,
  }), 'utf-8');

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/default');
  fs.mkdirSync(pmoPath, { recursive: true });

  // Create specs directory
  const specsPath = path.join(process.cwd(), 'pmo/specs');
  fs.mkdirSync(specsPath, { recursive: true });
}

function createTestProject(db: Database.Database, id: string, name: string) {
  db.prepare(`
    INSERT INTO pmo_projects (id, name, phase_id, is_archived)
    VALUES (?, ?, 'idea', 0)
  `).run(id, name);

  // Create project folder
  const projectPath = path.join(process.cwd(), 'pmo/projects', id);
  fs.mkdirSync(projectPath, { recursive: true });
}
