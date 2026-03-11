import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { execInProcess } from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

/**
 * End-to-end tests for Cross-Entity Dependency Commands
 * Tests: prlt ticket project, epic project
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

    it('should move ticket to different project', async () => {
      await execInProcess('ticket create --title "Move me" --column "Backlog" -P test-project --machine');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Move me') as { id: string };

      const output = await execInProcess(`ticket project ${ticket.id} target-project -P test-project --machine`);

      expect(output).to.contain('Moved');
      expect(output).to.contain(ticket.id);
      expect(output).to.contain('target-project');

      // Verify ticket is now in target project
      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { project_id: string };
      expect(movedTicket.project_id).to.equal('target-project');
    });

    it('should update board position when moving ticket', async () => {
      await execInProcess('ticket create --title "Board move" --column "Backlog" -P test-project --machine');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board move') as { id: string };

      await execInProcess(`ticket project ${ticket.id} target-project -P test-project --machine`);

      // Verify ticket is now in target project
      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { project_id: string };
      expect(movedTicket.project_id).to.equal('target-project');
    });

    it('should error if ticket is already in target project', async () => {
      await execInProcess('ticket create --title "Same project" --column "Backlog" -P test-project --machine');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same project') as { id: string };

      const output = await execInProcess(`ticket project ${ticket.id} test-project -P test-project --machine`);

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent ticket', async () => {
      const output = await execInProcess('ticket project NON-EXISTENT target-project -P test-project --machine');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', async () => {
      await execInProcess('ticket create --title "Bad project" --column "Backlog" -P test-project --machine');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad project') as { id: string };

      const output = await execInProcess(`ticket project ${ticket.id} NON-EXISTENT -P test-project --machine`);

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

    it('should move epic to different project', async () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-MOVE', 'test-project', 'Epic to move', 'active')
      `).run();

      const output = await execInProcess('epic project EPIC-MOVE epic-target -P test-project --machine');

      expect(output).to.contain('Moved');
      expect(output).to.contain('EPIC-MOVE');
      expect(output).to.contain('epic-target');

      // Verify epic is now in target project
      const movedEpic = db.prepare('SELECT project_id FROM pmo_epics WHERE id = ?').get('EPIC-MOVE') as { project_id: string };
      expect(movedEpic.project_id).to.equal('epic-target');
    });

    it('should move epic with tickets using --with-tickets', async () => {
      // Create epic with tickets
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-WITH-TKT', 'test-project', 'Epic with tickets', 'active')
      `).run();

      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, epic_id)
        VALUES ('TKT-EPIC-1', 'test-project', 'Ticket in epic', 'EPIC-WITH-TKT')
      `).run();

      const output = await execInProcess('epic project EPIC-WITH-TKT epic-target --with-tickets -P test-project --machine');

      expect(output).to.contain('Moved');
      expect(output).to.contain('1 ticket');

      // Verify both epic and ticket moved
      const movedEpic = db.prepare('SELECT project_id FROM pmo_epics WHERE id = ?').get('EPIC-WITH-TKT') as { project_id: string };
      expect(movedEpic.project_id).to.equal('epic-target');

      const movedTicket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get('TKT-EPIC-1') as { project_id: string };
      expect(movedTicket.project_id).to.equal('epic-target');
    });

    it('should error if epic is already in target project', async () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-SAME-PROJ', 'test-project', 'Same project epic', 'active')
      `).run();

      const output = await execInProcess('epic project EPIC-SAME-PROJ test-project -P test-project --machine');

      expect(output.toLowerCase()).to.contain('already');
    });

    it('should error for non-existent epic', async () => {
      const output = await execInProcess('epic project NON-EXISTENT epic-target -P test-project --machine');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error for non-existent target project', async () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-BAD-PROJ', 'test-project', 'Bad project epic', 'active')
      `).run();

      const output = await execInProcess('epic project EPIC-BAD-PROJ NON-EXISTENT -P test-project --machine');

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
