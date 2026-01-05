import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-to-end tests for PMO Phase Template Commands
 * Tests: prlt phase template list, apply, create, update, delete
 */
describe('PMO Phase Template Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-phase-template-e2e-'));
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

  describe('prlt phase template list', () => {
    it('should list all phase templates', () => {
      const output = exec('phase template list');

      expect(output).to.contain('Phase Templates');
      expect(output).to.contain('default');
      expect(output).to.contain('agile');
    });

    it('should show built-in templates section', () => {
      const output = exec('phase template list');

      expect(output).to.contain('Built-in Templates');
    });

    it('should filter to builtin only with --builtin', () => {
      const output = exec('phase template list --builtin');

      expect(output).to.contain('Built-in Templates');
      expect(output).not.to.contain('Custom Templates');
    });

    it('should show template descriptions', () => {
      const output = exec('phase template list');

      expect(output).to.contain('Standard project lifecycle');
      expect(output).to.contain('Agile/Scrum');
    });

    it('should output JSON with --json flag', () => {
      const output = exec('phase template list --json');

      const templates = JSON.parse(output);
      expect(templates).to.be.an('array');
      expect(templates.length).to.be.at.least(2);
      expect(templates.some((t: { id: string }) => t.id === 'default')).to.be.true;
    });

    it('should show phases grouped by category', () => {
      const output = exec('phase template list');

      // Should show category groupings with emojis
      expect(output).to.match(/📥|📋|🚀|✅|🚫/);
    });
  });

  describe('prlt phase template apply', () => {
    it('should apply template to workspace', () => {
      const output = exec('phase template apply agile --force');

      expect(output).to.contain('Applied phase template');
      expect(output).to.contain('Agile');

      // Verify phases were created
      const phases = db.prepare('SELECT * FROM pmo_phases').all();
      expect(phases.length).to.be.greaterThan(0);
    });

    it('should create phases from template', () => {
      exec('phase template apply agile --force');

      const phases = db.prepare('SELECT name FROM pmo_phases').all() as { name: string }[];
      const names = phases.map(p => p.name);

      expect(names).to.include('Backlog');
      expect(names).to.include('In Sprint');
      expect(names).to.include('Done');
    });

    it('should set a default phase', () => {
      exec('phase template apply agile --force');

      const defaultPhase = db.prepare('SELECT * FROM pmo_phases WHERE is_default = 1').get();
      expect(defaultPhase).to.not.be.undefined;
    });

    it('should error when template not found', () => {
      const output = exec('phase template apply non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should replace existing phases', () => {
      // First apply default
      exec('phase template apply default --force');

      // Then apply agile
      exec('phase template apply agile --force');

      const phases = db.prepare('SELECT * FROM pmo_phases').all() as { name: string }[];
      const names = phases.map(p => p.name);

      // Should have agile phases, not default
      expect(names).to.include('In Sprint');
      expect(names).to.include('Groomed');
    });

    it('should apply product template', () => {
      exec('phase template apply product --force');

      const phases = db.prepare('SELECT name FROM pmo_phases').all() as { name: string }[];
      const names = phases.map(p => p.name);

      expect(names).to.include('Discovery');
      expect(names).to.include('Definition');
      expect(names).to.include('Launch');
    });
  });

  describe('prlt phase template create', () => {
    it('should create template from workspace phases', () => {
      const output = exec('phase template create "My Custom Phases"');

      expect(output).to.contain('Created phase template');
      expect(output).to.contain('My Custom Phases');

      // Verify template was created
      const template = db.prepare('SELECT * FROM pmo_phase_templates WHERE name = ?').get('My Custom Phases');
      expect(template).to.not.be.undefined;
    });

    it('should generate slugified ID', () => {
      exec('phase template create "My Workflow Phases"');

      const template = db.prepare('SELECT id FROM pmo_phase_templates WHERE name = ?').get('My Workflow Phases') as { id: string };
      expect(template.id).to.equal('my-workflow-phases');
    });

    it('should include description when provided', () => {
      exec('phase template create "Team Phases" --description "Our team phase workflow"');

      const template = db.prepare('SELECT description FROM pmo_phase_templates WHERE name = ?').get('Team Phases') as { description: string };
      expect(template.description).to.equal('Our team phase workflow');
    });

    it('should not be marked as builtin', () => {
      exec('phase template create "User Phases"');

      const template = db.prepare('SELECT is_builtin FROM pmo_phase_templates WHERE name = ?').get('User Phases') as { is_builtin: number };
      expect(template.is_builtin).to.equal(0);
    });

    it('should error when name already exists', () => {
      exec('phase template create "Duplicate"');
      const output = exec('phase template create "Duplicate"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should preserve phases in template', () => {
      exec('phase template create "Preserved Template"');

      const template = db.prepare('SELECT phases FROM pmo_phase_templates WHERE name = ?').get('Preserved Template') as { phases: string };
      const phases = JSON.parse(template.phases);

      expect(phases).to.be.an('array');
      expect(phases.length).to.be.greaterThan(0);
      expect(phases.some((p: { name: string }) => p.name === 'Idea')).to.be.true;
    });
  });

  describe('prlt phase template update', () => {
    beforeEach(() => {
      exec('phase template create "Updatable Template"');
    });

    it('should update template name', () => {
      exec('phase template update updatable-template --name "New Name"');

      const template = db.prepare('SELECT name FROM pmo_phase_templates WHERE id = ?').get('updatable-template') as { name: string };
      expect(template.name).to.equal('New Name');
    });

    it('should update template description', () => {
      exec('phase template update updatable-template --description "New description"');

      const template = db.prepare('SELECT description FROM pmo_phase_templates WHERE id = ?').get('updatable-template') as { description: string };
      expect(template.description).to.equal('New description');
    });

    it('should error when template not found', () => {
      const output = exec('phase template update non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when updating built-in template', () => {
      const output = exec('phase template update default --name "New Default"');

      expect(output.toLowerCase()).to.contain('cannot modify');
    });
  });

  describe('prlt phase template delete', () => {
    beforeEach(() => {
      exec('phase template create "Deletable Template"');
    });

    it('should delete template', () => {
      exec('phase template delete deletable-template --force');

      const template = db.prepare('SELECT * FROM pmo_phase_templates WHERE id = ?').get('deletable-template');
      expect(template).to.be.undefined;
    });

    it('should error when template not found', () => {
      const output = exec('phase template delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when deleting built-in template', () => {
      const output = exec('phase template delete default --force');

      expect(output.toLowerCase()).to.contain('cannot delete');
    });

    it('should show success message', () => {
      const output = exec('phase template delete deletable-template --force');

      expect(output).to.contain('Deleted phase template');
    });
  });

  describe('phase template workflow', () => {
    it('should allow creating and reapplying custom template', () => {
      // Apply a template
      exec('phase template apply product --force');

      // Create as custom template
      exec('phase template create "Product Copy"');

      // Apply default to reset
      exec('phase template apply default --force');

      // Apply saved template
      exec('phase template apply product-copy --force');

      // Verify it worked
      const phases = db.prepare('SELECT name FROM pmo_phases').all() as { name: string }[];
      const names = phases.map(p => p.name);

      expect(names).to.include('Discovery');
      expect(names).to.include('Launch');
    });

    it('should list custom templates after creation', () => {
      exec('phase template create "Custom One"');
      exec('phase template create "Custom Two"');

      const output = exec('phase template list --custom');

      expect(output).to.contain('Custom Templates');
      expect(output).to.contain('Custom One');
      expect(output).to.contain('Custom Two');
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  // Use the complete schema from the actual codebase
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

    -- Phase templates table
    CREATE TABLE IF NOT EXISTS pmo_phase_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      phases TEXT NOT NULL,
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

    -- Specs table
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

    -- Epics table
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

    -- Statuses table (must be before tickets due to FK)
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
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id)
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

    -- Cache metadata table
    CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON pmo_phases(category);
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

  // Seed built-in phase templates
  const builtinPhaseTemplates = [
    {
      id: 'default',
      name: 'Default',
      description: 'Standard project lifecycle phases',
      phases: JSON.stringify([
        { name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: true },
        { name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
        { name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
        { name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
        { name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
      ]),
    },
    {
      id: 'agile',
      name: 'Agile',
      description: 'Agile/Scrum project phases',
      phases: JSON.stringify([
        { name: 'Backlog', category: 'backlog', position: 0, description: 'Not yet prioritized' },
        { name: 'Groomed', category: 'unstarted', position: 0, description: 'Ready to be picked up' },
        { name: 'In Sprint', category: 'started', position: 0, description: 'Actively being worked on', isDefault: true },
        { name: 'Done', category: 'completed', position: 0, description: 'Sprint work completed' },
        { name: 'Dropped', category: 'canceled', position: 0, description: 'Removed from backlog' },
      ]),
    },
    {
      id: 'product',
      name: 'Product',
      description: 'Product development lifecycle',
      phases: JSON.stringify([
        { name: 'Discovery', category: 'backlog', position: 0, description: 'Research and exploration' },
        { name: 'Definition', category: 'unstarted', position: 0, description: 'Requirements and specs', isDefault: true },
        { name: 'Development', category: 'started', position: 0, description: 'Building the product' },
        { name: 'Launch', category: 'completed', position: 0, description: 'Shipped to users' },
        { name: 'Growth', category: 'completed', position: 1, description: 'Post-launch iteration' },
        { name: 'Sunset', category: 'canceled', position: 0, description: 'End of life' },
      ]),
    },
    {
      id: 'startup',
      name: 'Startup',
      description: 'Lean startup methodology',
      phases: JSON.stringify([
        { name: 'Hypothesis', category: 'backlog', position: 0, description: 'Untested idea' },
        { name: 'Validated', category: 'unstarted', position: 0, description: 'Problem validated', isDefault: true },
        { name: 'Building', category: 'started', position: 0, description: 'MVP in progress' },
        { name: 'Measuring', category: 'started', position: 1, description: 'Collecting feedback' },
        { name: 'Scaling', category: 'completed', position: 0, description: 'Growth phase' },
        { name: 'Pivoted', category: 'canceled', position: 0, description: 'Changed direction' },
      ]),
    },
  ];

  for (const template of builtinPhaseTemplates) {
    db.prepare(`
      INSERT INTO pmo_phase_templates (id, name, description, is_builtin, phases)
      VALUES (?, ?, ?, 1, ?)
    `).run(template.id, template.name, template.description, template.phases);
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

  // Seed default statuses
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

function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    const result = execSync(`${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    return result;
  } catch (error: any) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    if (stdout.trim()) {
      return stdout;
    }
    const filteredStderr = stderr.split('\n').filter((line: string) =>
      !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
      !line.includes('Warning:') &&
      !line.includes('module: @oclif')
    ).join('\n');
    return filteredStderr || error.message;
  }
}
