import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('spec-001', 'Test Spec', 'active')
      `).run();

      // Create a ticket
      exec('ticket create --title "Ticket for spec" --column "Backlog"');
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('spec-unlink', 'Spec to Unlink', 'active')
      `).run();

      exec('ticket create --title "Ticket to unlink" --column "Backlog"');
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('spec-same', 'Same Spec', 'active')
      `).run();

      exec('ticket create --title "Same spec ticket" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same spec ticket') as { id: string };

      // Link first
      exec(`ticket spec ${ticket.id} spec-same`);

      // Try to link again
      const output = exec(`ticket spec ${ticket.id} spec-same`);

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent spec', () => {
      exec('ticket create --title "Bad spec ticket" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad spec ticket') as { id: string };

      const output = exec(`ticket spec ${ticket.id} NON-EXISTENT`);

      // Command may say "not found" or "no specs found" depending on whether any specs exist
      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('not found') || s.includes('no specs')
      );
    });
  });

  describe('prlt epic spec', () => {
    it('should link epic to spec with args', () => {
      // Create spec
      db.prepare(`
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('epic-spec-001', 'Epic Spec', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('epic-unlink-spec', 'Epic Unlink Spec', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('epic-same-spec', 'Same Epic Spec', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('orphan-spec', 'Orphan Spec', 'active')
      `).run();

      const output = exec('epic spec NON-EXISTENT orphan-spec');

      // Command may say "not found" or "no epics found" depending on whether any epics exist
      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('not found') || s.includes('no epics')
      );
    });
  });

  describe('prlt project spec', () => {
    it('should add spec to project with --add flag', () => {
      db.prepare(`
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('proj-spec-001', 'Project Spec', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('proj-remove-spec', 'Spec to Remove', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES
          ('multi-spec-1', 'Multi Spec 1', 'active'),
          ('multi-spec-2', 'Multi Spec 2', 'active')
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
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('already-added', 'Already Added', 'active')
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
        { id: 'backlog', name: 'Backlog', position: 0 },
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
      exec('ticket create --title "Move me" --column "Backlog" -P test-project');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Move me') as { id: string };

      const output = exec(`ticket project ${ticket.id} target-project -P test-project`);

      expect(output).to.contain('Moved');
      expect(output).to.contain(ticket.id);
      expect(output).to.contain('target-project');

      // Verify ticket is now in target project
      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { project_id: string };
      expect(movedTicket.project_id).to.equal('target-project');
    });

    it('should update board position when moving ticket', () => {
      exec('ticket create --title "Board move" --column "Backlog" -P test-project');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board move') as { id: string };

      exec(`ticket project ${ticket.id} target-project -P test-project`);

      // Verify ticket is now in target project
      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { project_id: string };
      expect(movedTicket.project_id).to.equal('target-project');
    });

    it('should error if ticket is already in target project', () => {
      exec('ticket create --title "Same project" --column "Backlog" -P test-project');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same project') as { id: string };

      const output = exec(`ticket project ${ticket.id} test-project -P test-project`);

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent ticket', () => {
      const output = exec('ticket project NON-EXISTENT target-project -P test-project');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', () => {
      exec('ticket create --title "Bad project" --column "Backlog" -P test-project');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad project') as { id: string };

      const output = exec(`ticket project ${ticket.id} NON-EXISTENT -P test-project`);

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

      // Create PMO directory for target project
      const targetPmoPath = path.join(process.cwd(), 'pmo/projects/epic-target');
      fs.mkdirSync(targetPmoPath, { recursive: true });
    });

    it('should move epic to different project', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-MOVE', 'test-project', 'Epic to move', 'active')
      `).run();

      const output = exec('epic project EPIC-MOVE epic-target -P test-project');

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

      const output = exec('epic project EPIC-WITH-TKT epic-target --with-tickets -P test-project');

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

      const output = exec('epic project EPIC-SAME-PROJ test-project -P test-project');

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent epic', () => {
      const output = exec('epic project NON-EXISTENT epic-target -P test-project');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-BAD-PROJ', 'test-project', 'Bad project epic', 'active')
      `).run();

      const output = exec('epic project EPIC-BAD-PROJ NON-EXISTENT -P test-project');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Use production PMO schema (ensures all columns including position, labels,
  // depends_on_ticket_id, epic_id, etc.)
  initializePMOTables(db);

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('current_project', 'test-project')
  `).run();

  // Legacy columns (kept for backwards compatibility with board_tickets tests)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
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
