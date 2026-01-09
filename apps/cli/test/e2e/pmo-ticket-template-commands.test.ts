import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

/**
 * End-to-end tests for PMO Ticket Template Commands
 * Tests: prlt ticket template list, apply, save, delete
 */
describe('PMO Ticket Template Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ticket-template-e2e-'));
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

  describe('prlt ticket template list', () => {
    it('should list all ticket templates', () => {
      const output = exec('ticket template list');

      expect(output).to.contain('Ticket Templates');
      expect(output).to.contain('bug-report');
      expect(output).to.contain('feature-request');
    });

    it('should show built-in templates', () => {
      const output = exec('ticket template list');

      expect(output).to.contain('Built-in Templates');
      expect(output).to.contain('Bug Report');
      expect(output).to.contain('Feature Request');
      expect(output).to.contain('Task');
    });

    it('should filter to builtin only with --builtin', () => {
      const output = exec('ticket template list --builtin');

      expect(output).to.contain('Built-in Templates');
      expect(output).not.to.contain('Custom Templates');
    });

    it('should filter to custom only with --custom', () => {
      // First create a custom template
      createTestTicket(db, 'TKT-001', 'Test Ticket');
      exec('ticket template save TKT-001 "My Custom Template"');

      const output = exec('ticket template list --custom');

      expect(output).to.contain('Custom Templates');
      expect(output).to.contain('My Custom Template');
      expect(output).not.to.contain('Built-in Templates');
    });

    it('should output JSON with --json flag', () => {
      const output = exec('ticket template list --json');

      const templates = JSON.parse(output);
      expect(templates).to.be.an('array');
      expect(templates.length).to.be.at.least(5); // 5 built-in templates
      expect(templates.some((t: { id: string }) => t.id === 'bug-report')).to.be.true;
      expect(templates.some((t: { id: string }) => t.id === 'feature-request')).to.be.true;
    });
  });

  describe('prlt ticket template apply', () => {
    it('should create ticket from bug-report template', () => {
      const output = exec('ticket template apply bug-report --title "Login page crashes"');

      expect(output).to.contain('Created ticket');
      expect(output).to.contain('Bug Report');

      // Verify ticket was created
      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE title LIKE ?').get('%Login page crashes%') as { id: string; title: string; priority: string; category: string } | undefined;
      expect(ticket).to.not.be.undefined;
      expect(ticket?.priority).to.equal('HIGH');
      expect(ticket?.category).to.equal('bug');
    });

    it('should create ticket from feature-request template', () => {
      const output = exec('ticket template apply feature-request --title "Add dark mode"');

      expect(output).to.contain('Created ticket');
      expect(output).to.contain('Feature Request');

      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE title LIKE ?').get('%Add dark mode%') as { priority: string; category: string } | undefined;
      expect(ticket).to.not.be.undefined;
      expect(ticket?.priority).to.equal('MEDIUM');
      expect(ticket?.category).to.equal('feature');
    });

    it('should create subtasks from template', () => {
      exec('ticket template apply bug-report --title "Fix crash"');

      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title LIKE ?').get('%Fix crash%') as { id: string } | undefined;
      expect(ticket).to.not.be.undefined;

      const subtasks = db.prepare('SELECT * FROM pmo_subtasks WHERE ticket_id = ?').all(ticket!.id);
      expect(subtasks.length).to.be.greaterThan(0);
    });

    it('should override template defaults with flags', () => {
      exec('ticket template apply bug-report --title "Minor issue" --priority LOW --category chore');

      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE title LIKE ?').get('%Minor issue%') as { priority: string; category: string } | undefined;
      expect(ticket).to.not.be.undefined;
      expect(ticket?.priority).to.equal('LOW');
      expect(ticket?.category).to.equal('chore');
    });

    it('should skip subtasks with --no-subtasks', () => {
      exec('ticket template apply bug-report --title "No subtasks" --no-subtasks');

      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title LIKE ?').get('%No subtasks%') as { id: string } | undefined;
      expect(ticket).to.not.be.undefined;

      const subtasks = db.prepare('SELECT * FROM pmo_subtasks WHERE ticket_id = ?').all(ticket!.id);
      expect(subtasks.length).to.equal(0);
    });

    it('should error when template not found', () => {
      const output = exec('ticket template apply non-existent --title "Test"');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt ticket template save', () => {
    beforeEach(() => {
      createTestTicket(db, 'TKT-001', 'Original Ticket', {
        priority: 'HIGH',
        category: 'feature',
        description: 'Test description',
      });
    });

    it('should create template from ticket', () => {
      const output = exec('ticket template save TKT-001 "My Template"');

      expect(output).to.contain('Created template');
      expect(output).to.contain('My Template');

      const template = db.prepare('SELECT * FROM pmo_ticket_templates WHERE name = ?').get('My Template') as { id: string; default_priority: string; default_category: string } | undefined;
      expect(template).to.not.be.undefined;
      expect(template?.default_priority).to.equal('HIGH');
      expect(template?.default_category).to.equal('feature');
    });

    it('should include description in template', () => {
      exec('ticket template save TKT-001 "Template With Desc" --description "A reusable template"');

      const template = db.prepare('SELECT * FROM pmo_ticket_templates WHERE name = ?').get('Template With Desc') as { description: string } | undefined;
      expect(template?.description).to.equal('A reusable template');
    });

    it('should error when ticket not found', () => {
      const output = exec('ticket template save TKT-999 "Bad Template"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when template name already exists', () => {
      exec('ticket template save TKT-001 "Duplicate Name"');
      const output = exec('ticket template save TKT-001 "Duplicate Name"');

      expect(output.toLowerCase()).to.contain('already exists');
    });
  });

  describe('prlt ticket template delete', () => {
    beforeEach(() => {
      createTestTicket(db, 'TKT-001', 'Source Ticket');
      exec('ticket template save TKT-001 "Deletable Template"');
    });

    it('should delete custom template', () => {
      const output = exec('ticket template delete deletable-template --force');

      expect(output).to.contain('Deleted template');

      const template = db.prepare('SELECT * FROM pmo_ticket_templates WHERE id = ?').get('deletable-template');
      expect(template).to.be.undefined;
    });

    it('should error when template not found', () => {
      const output = exec('ticket template delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when deleting built-in template', () => {
      const output = exec('ticket template delete bug-report --force');

      expect(output.toLowerCase()).to.contain('cannot delete');
    });
  });

  describe('ticket template workflow', () => {
    it('should save ticket as template and create new ticket from it', () => {
      // Create source ticket
      createTestTicket(db, 'TKT-001', 'Sprint Planning Template', {
        priority: 'MEDIUM',
        category: 'chore',
        description: 'Sprint planning checklist',
      });

      // Save as template
      exec('ticket template save TKT-001 "Sprint Planning"');

      // Create new ticket from template
      const output = exec('ticket template apply sprint-planning --title "Sprint 42 Planning"');

      expect(output).to.contain('Created ticket');
      expect(output).to.contain('Sprint Planning');

      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE title LIKE ?').get('%Sprint 42%') as { priority: string; category: string } | undefined;
      expect(ticket).to.not.be.undefined;
      expect(ticket?.priority).to.equal('MEDIUM');
      expect(ticket?.category).to.equal('chore');
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

    -- Projects table
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT DEFAULT 'kanban',
      description TEXT,
      phase_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Columns table
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES pmo_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    -- Statuses table
    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES pmo_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Tickets table
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default' REFERENCES pmo_projects(id) ON DELETE CASCADE,
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
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id)
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

    -- Ticket templates table
    CREATE TABLE IF NOT EXISTS pmo_ticket_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      title_pattern TEXT,
      description_template TEXT,
      default_priority TEXT,
      default_category TEXT,
      default_status_id TEXT,
      default_assignee TEXT,
      default_owner TEXT,
      default_labels TEXT NOT NULL DEFAULT '[]',
      suggested_subtasks TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Phases table
    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Cache metadata table
    CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_ticket_templates_builtin ON pmo_ticket_templates(is_builtin);
  `);

  // Seed default phases
  const defaultPhases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: 1 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
    { id: 'active', name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
    { id: 'completed', name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
    { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
  ];

  const insertPhase = db.prepare(`
    INSERT OR IGNORE INTO pmo_phases (id, name, category, position, description, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const phase of defaultPhases) {
    insertPhase.run(phase.id, phase.name, phase.category, phase.position, phase.description, phase.isDefault || 0);
  }

  // Seed built-in ticket templates
  const builtinTemplates = [
    {
      id: 'bug-report',
      name: 'Bug Report',
      description: 'Template for reporting bugs with reproduction steps',
      titlePattern: '[BUG] ',
      defaultPriority: 'HIGH',
      defaultCategory: 'bug',
      suggestedSubtasks: [
        { title: 'Reproduce the bug' },
        { title: 'Identify root cause' },
        { title: 'Implement fix' },
        { title: 'Add regression test' },
      ],
    },
    {
      id: 'feature-request',
      name: 'Feature Request',
      description: 'Template for new feature requests',
      titlePattern: '[FEATURE] ',
      defaultPriority: 'MEDIUM',
      defaultCategory: 'feature',
      suggestedSubtasks: [
        { title: 'Design implementation approach' },
        { title: 'Implement feature' },
        { title: 'Add tests' },
        { title: 'Update documentation' },
      ],
    },
    {
      id: 'task',
      name: 'Task',
      description: 'General task template',
      defaultPriority: 'MEDIUM',
      defaultCategory: 'chore',
      suggestedSubtasks: [],
    },
    {
      id: 'refactor',
      name: 'Refactor',
      description: 'Template for refactoring tasks',
      titlePattern: '[REFACTOR] ',
      defaultPriority: 'LOW',
      defaultCategory: 'refactor',
      suggestedSubtasks: [
        { title: 'Analyze current code' },
        { title: 'Plan refactoring approach' },
        { title: 'Implement changes' },
        { title: 'Ensure tests pass' },
      ],
    },
    {
      id: 'documentation',
      name: 'Documentation',
      description: 'Template for documentation tasks',
      titlePattern: '[DOCS] ',
      defaultPriority: 'LOW',
      defaultCategory: 'docs',
      suggestedSubtasks: [
        { title: 'Draft content' },
        { title: 'Review for accuracy' },
        { title: 'Add examples if needed' },
      ],
    },
  ];

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO pmo_ticket_templates (
      id, name, description, is_builtin, title_pattern, description_template,
      default_priority, default_category, default_status_id, default_assignee,
      default_owner, default_labels, suggested_subtasks, created_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const template of builtinTemplates) {
    insertTemplate.run(
      template.id,
      template.name,
      template.description || null,
      template.titlePattern || null,
      null, // description_template
      template.defaultPriority || null,
      template.defaultCategory || null,
      null, // default_status_id
      null, // default_assignee
      null, // default_owner
      '[]', // default_labels
      JSON.stringify(template.suggestedSubtasks || []),
      now
    );
  }

  // Create default project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, template, phase_id, is_archived)
    VALUES ('default', 'Default Project', 'kanban', 'idea', 0)
  `).run();

  // Create default columns
  const columns = ['Backlog', 'To Do', 'In Progress', 'Done'];
  const insertColumn = db.prepare(`
    INSERT INTO pmo_columns (id, project_id, name, position)
    VALUES (?, 'default', ?, ?)
  `);
  columns.forEach((name, idx) => {
    insertColumn.run(name.toLowerCase().replace(/ /g, '-'), name, idx);
  });

  // Create default statuses
  const statuses = [
    { id: 'backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'todo', name: 'To Do', category: 'unstarted', position: 0, isDefault: 0 },
    { id: 'in-progress', name: 'In Progress', category: 'started', position: 0, isDefault: 0 },
    { id: 'done', name: 'Done', category: 'completed', position: 0, isDefault: 0 },
  ];
  const insertStatus = db.prepare(`
    INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
    VALUES (?, 'default', ?, ?, ?, ?)
  `);
  for (const status of statuses) {
    insertStatus.run(status.id, status.name, status.category, status.position, status.isDefault);
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
}

function createTestTicket(
  db: Database.Database,
  id: string,
  title: string,
  options: { priority?: string; category?: string; description?: string } = {}
) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, description, priority, category, status_id, labels, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, ?, 'backlog', '[]', ?, ?)
  `).run(id, title, options.description || null, options.priority || null, options.category || null, now, now);

  // Add to board
  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('default', ?, 'backlog', 0)
  `).run(id);
}

