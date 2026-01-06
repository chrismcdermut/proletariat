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
 * End-to-end tests for Cross-Entity Dependency Commands
 * Tests: prlt ticket spec, epic spec, project spec, ticket project, epic project
 * Spec: TKT-043 Cross-Entity Dependencies
 */
describe('PMO Cross-Entity Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-cross-entity-e2e-'));
    process.chdir(testDir);

    // Setup test environment
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

  describe('prlt ticket spec', () => {
    it('should link ticket to spec with args', () => {
      // Create a spec first
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('spec-001', '/specs/spec-001.md', 'Test Spec', 'active')
      `).run();

      // Create a ticket
      exec('ticket create --title "Ticket for spec" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Ticket for spec') as { id: string };

      // Link ticket to spec
      const output = exec(`ticket spec ${ticket.id} spec-001`);

      expect(output).to.contain('Linked');
      expect(output).to.contain(ticket.id);
      expect(output).to.contain('spec-001');

      // Verify in database
      const linkedTicket = db.prepare('SELECT spec_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { spec_id: string };
      expect(linkedTicket.spec_id).to.equal('spec-001');
    });

    it('should unlink spec from ticket', () => {
      // Create spec and ticket with link
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('spec-unlink', '/specs/spec-unlink.md', 'Spec to Unlink', 'active')
      `).run();

      exec('ticket create --title "Ticket to unlink" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Ticket to unlink') as { id: string };

      // Link first
      db.prepare('UPDATE pmo_tickets SET spec_id = ? WHERE id = ?').run('spec-unlink', ticket.id);

      // Unlink
      const output = exec(`ticket spec ${ticket.id} --unlink`);

      expect(output).to.contain('Unlinked');

      // Verify in database
      const unlinkedTicket = db.prepare('SELECT spec_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { spec_id: string | null };
      expect(unlinkedTicket.spec_id).to.be.null;
    });

    it('should detect already linked to same spec', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('spec-same', '/specs/spec-same.md', 'Same Spec', 'active')
      `).run();

      exec('ticket create --title "Same spec ticket" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same spec ticket') as { id: string };

      // Link first
      exec(`ticket spec ${ticket.id} spec-same`);

      // Try to link again
      const output = exec(`ticket spec ${ticket.id} spec-same`);

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent spec', () => {
      exec('ticket create --title "Bad spec ticket" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad spec ticket') as { id: string };

      const output = exec(`ticket spec ${ticket.id} NON-EXISTENT`);

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt epic spec', () => {
    it('should link epic to spec with args', () => {
      // Create spec
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('epic-spec-001', '/specs/epic-spec-001.md', 'Epic Spec', 'active')
      `).run();

      // Create epic
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-LINK', 'test-project', 'Epic for linking', 'active')
      `).run();

      const output = exec('epic spec EPIC-LINK epic-spec-001');

      expect(output).to.contain('Linked');
      expect(output).to.contain('EPIC-LINK');
      expect(output).to.contain('epic-spec-001');

      // Verify in database
      const linkedEpic = db.prepare('SELECT spec_id FROM pmo_epics WHERE id = ?').get('EPIC-LINK') as { spec_id: string };
      expect(linkedEpic.spec_id).to.equal('epic-spec-001');
    });

    it('should unlink spec from epic', () => {
      // Create spec and epic with link
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('epic-unlink-spec', '/specs/epic-unlink.md', 'Epic Unlink Spec', 'active')
      `).run();

      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status, spec_id)
        VALUES ('EPIC-UNLINK', 'test-project', 'Epic to unlink', 'active', 'epic-unlink-spec')
      `).run();

      const output = exec('epic spec EPIC-UNLINK --unlink');

      expect(output).to.contain('Unlinked');

      // Verify in database
      const unlinkedEpic = db.prepare('SELECT spec_id FROM pmo_epics WHERE id = ?').get('EPIC-UNLINK') as { spec_id: string | null };
      expect(unlinkedEpic.spec_id).to.be.null;
    });

    it('should detect already linked to same spec', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('epic-same-spec', '/specs/epic-same.md', 'Same Epic Spec', 'active')
      `).run();

      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status, spec_id)
        VALUES ('EPIC-SAME', 'test-project', 'Same spec epic', 'active', 'epic-same-spec')
      `).run();

      const output = exec('epic spec EPIC-SAME epic-same-spec');

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent epic', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('orphan-spec', '/specs/orphan.md', 'Orphan Spec', 'active')
      `).run();

      const output = exec('epic spec NON-EXISTENT orphan-spec');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt project spec', () => {
    it('should add spec to project with --add flag', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('proj-spec-001', '/specs/proj-spec.md', 'Project Spec', 'active')
      `).run();

      const output = exec('project spec test-project --add proj-spec-001');

      expect(output).to.contain('Added');
      expect(output).to.contain('proj-spec-001');
      expect(output).to.contain('test-project');

      // Verify in database
      const link = db.prepare(`
        SELECT * FROM pmo_project_specs
        WHERE project_id = ? AND spec_id = ?
      `).get('test-project', 'proj-spec-001');
      expect(link).to.not.be.undefined;
    });

    it('should remove spec from project with --remove flag', () => {
      // Add spec to project first
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('proj-remove-spec', '/specs/proj-remove.md', 'Spec to Remove', 'active')
      `).run();

      db.prepare(`
        INSERT INTO pmo_project_specs (project_id, spec_id)
        VALUES ('test-project', 'proj-remove-spec')
      `).run();

      const output = exec('project spec test-project --remove proj-remove-spec');

      expect(output).to.contain('Removed');
      expect(output).to.contain('proj-remove-spec');

      // Verify removed from database
      const link = db.prepare(`
        SELECT * FROM pmo_project_specs
        WHERE project_id = ? AND spec_id = ?
      `).get('test-project', 'proj-remove-spec');
      expect(link).to.be.undefined;
    });

    it('should handle multiple specs per project', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES
          ('multi-spec-1', '/specs/multi-1.md', 'Multi Spec 1', 'active'),
          ('multi-spec-2', '/specs/multi-2.md', 'Multi Spec 2', 'active')
      `).run();

      exec('project spec test-project --add multi-spec-1');
      exec('project spec test-project --add multi-spec-2');

      const links = db.prepare(`
        SELECT * FROM pmo_project_specs
        WHERE project_id = ?
      `).all('test-project');
      expect(links).to.have.lengthOf(2);
    });

    it('should detect already added spec', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('already-added', '/specs/already.md', 'Already Added', 'active')
      `).run();

      exec('project spec test-project --add already-added');
      const output = exec('project spec test-project --add already-added');

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent spec with --add', () => {
      const output = exec('project spec test-project --add NON-EXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt ticket project', () => {
    beforeEach(() => {
      // Create a second project for movement tests
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description)
        VALUES ('target-project', 'Target Project', 'Project to move tickets to')
      `).run();

      // Add columns to target project
      const columns = [
        { id: 'backlog', name: 'SHIP BL', position: 0 },
        { id: 'in-progress', name: 'In Progress', position: 1 },
        { id: 'done', name: 'Done', position: 2 },
      ];
      for (const col of columns) {
        db.prepare(`
          INSERT INTO pmo_columns (id, project_id, name, position)
          VALUES (?, 'target-project', ?, ?)
        `).run(col.id, col.name, col.position);
      }

      // Create PMO directory for target project
      const targetPmoPath = path.join(process.cwd(), 'pmo/projects/target-project');
      fs.mkdirSync(targetPmoPath, { recursive: true });
    });

    it('should move ticket to different project', () => {
      exec('ticket create --title "Move me" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Move me') as { id: string };

      const output = exec(`ticket project ${ticket.id} target-project`);

      expect(output).to.contain('Moved');
      expect(output).to.contain(ticket.id);
      expect(output).to.contain('target-project');

      // Verify ticket is now in target project
      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { project_id: string };
      expect(movedTicket.project_id).to.equal('target-project');
    });

    it('should update board position when moving ticket', () => {
      exec('ticket create --title "Board move" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board move') as { id: string };

      exec(`ticket project ${ticket.id} target-project`);

      // Verify board ticket is in target project
      const boardTicket = db.prepare(`
        SELECT project_id, column_id FROM pmo_board_tickets
        WHERE ticket_id = ?
      `).get(ticket.id) as { project_id: string; column_id: string };
      expect(boardTicket.project_id).to.equal('target-project');
    });

    it('should error if ticket is already in target project', () => {
      exec('ticket create --title "Same project" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same project') as { id: string };

      const output = exec(`ticket project ${ticket.id} test-project`);

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent ticket', () => {
      const output = exec('ticket project NON-EXISTENT target-project');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', () => {
      exec('ticket create --title "Bad project" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad project') as { id: string };

      const output = exec(`ticket project ${ticket.id} NON-EXISTENT`);

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt epic project', () => {
    beforeEach(() => {
      // Create a second project for movement tests
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description)
        VALUES ('epic-target', 'Epic Target Project', 'Project to move epics to')
      `).run();

      // Add columns to target project
      const columns = [
        { id: 'backlog', name: 'SHIP BL', position: 0 },
        { id: 'in-progress', name: 'In Progress', position: 1 },
        { id: 'done', name: 'Done', position: 2 },
      ];
      for (const col of columns) {
        db.prepare(`
          INSERT INTO pmo_columns (id, project_id, name, position)
          VALUES (?, 'epic-target', ?, ?)
        `).run(col.id, col.name, col.position);
      }

      // Create PMO directory for target project
      const targetPmoPath = path.join(process.cwd(), 'pmo/projects/epic-target');
      fs.mkdirSync(targetPmoPath, { recursive: true });
    });

    it('should move epic to different project', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-MOVE', 'test-project', 'Epic to move', 'active')
      `).run();

      const output = exec('epic project EPIC-MOVE epic-target');

      expect(output).to.contain('Moved');
      expect(output).to.contain('EPIC-MOVE');
      expect(output).to.contain('epic-target');

      // Verify epic is now in target project
      const movedEpic = db.prepare('SELECT project_id FROM pmo_epics WHERE id = ?').get('EPIC-MOVE') as { project_id: string };
      expect(movedEpic.project_id).to.equal('epic-target');
    });

    it('should move epic with tickets using --with-tickets', () => {
      // Create epic with tickets
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-WITH-TKT', 'test-project', 'Epic with tickets', 'active')
      `).run();

      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, epic_id)
        VALUES ('TKT-EPIC-1', 'test-project', 'Ticket in epic', 'EPIC-WITH-TKT')
      `).run();

      db.prepare(`
        INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
        VALUES ('test-project', 'TKT-EPIC-1', 'backlog', 0)
      `).run();

      const output = exec('epic project EPIC-WITH-TKT epic-target --with-tickets');

      expect(output).to.contain('Moved');
      expect(output).to.contain('1 ticket');

      // Verify both epic and ticket moved
      const movedEpic = db.prepare('SELECT project_id FROM pmo_epics WHERE id = ?').get('EPIC-WITH-TKT') as { project_id: string };
      expect(movedEpic.project_id).to.equal('epic-target');

      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get('TKT-EPIC-1') as { project_id: string };
      expect(movedTicket.project_id).to.equal('epic-target');
    });

    it('should error if epic is already in target project', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-SAME-PROJ', 'test-project', 'Same project epic', 'active')
      `).run();

      const output = exec('epic project EPIC-SAME-PROJ test-project');

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent epic', () => {
      const output = exec('epic project NON-EXISTENT epic-target');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-BAD-PROJ', 'test-project', 'Bad project epic', 'active')
      `).run();

      const output = exec('epic project EPIC-BAD-PROJ NON-EXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Create complete PMO schema (matches schema.ts)
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
      template TEXT,
      description TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    -- Project-to-spec associations (many-to-many, specs are global living documents)
    CREATE TABLE IF NOT EXISTS pmo_project_specs (
      project_id TEXT NOT NULL REFERENCES pmo_projects(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, spec_id)
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
      owner TEXT,
      assignee TEXT,
      branch TEXT,
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_spec_abilities_spec ON pmo_spec_abilities(spec_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_project_specs_project ON pmo_project_specs(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_project_specs_spec ON pmo_project_specs(spec_id);
  `);

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  const columns = [
    { id: 'backlog', name: 'SHIP BL', position: 0 },
    { id: 'ready', name: 'Ready', position: 1 },
    { id: 'in-progress', name: 'In Progress', position: 2 },
    { id: 'in-review', name: 'In Review', position: 3 },
    { id: 'merged', name: 'Merged', position: 4 },
    { id: 'done', name: 'Done', position: 5 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Workflow statuses (kanban template)
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-in-review', name: 'In Review', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
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
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
}

function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    // Run the CLI from the test's cwd
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
    // Command failed - capture both stdout and stderr
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    // Return stdout if available (for expected error messages)
    // Otherwise return filtered stderr (removing Node.js warnings)
    if (stdout.trim()) {
      return stdout;
    }
    // Filter out Node.js warnings from stderr
    const filteredStderr = stderr.split('\n').filter((line: string) =>
      !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
      !line.includes('Warning:') &&
      !line.includes('module: @oclif')
    ).join('\n');
    return filteredStderr || error.message;
  }
}
