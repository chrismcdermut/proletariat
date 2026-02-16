import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  exec,
  TestEnvironment,
} from './test-helpers.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

const T = PMO_TABLES;

/**
 * Tests for TKT-940: Orphaned default project causes ticket command crashes.
 *
 * These tests verify that ticket commands handle gracefully the case where
 * a ticket's project_id references a project that doesn't exist in the
 * pmo_projects table (e.g., the implicit 'default' project).
 */
describe('Orphaned Project Handling (TKT-940)', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('orphaned-project-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);

    // Create a valid project
    createTestProject(db, {
      id: 'PROJ-001',
      name: 'Valid Project',
      description: 'A valid project',
      workflowId: 'default',
    });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'PROJ-001');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to insert an orphaned ticket directly into the database.
   * This bypasses the normal createTicket flow which validates the project.
   */
  function insertOrphanedTicket(
    ticketId: string,
    projectId: string,
    title: string,
    statusId?: string,
  ): void {
    // Temporarily disable foreign keys to insert orphaned data
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT INTO ${T.tickets} (id, project_id, title, status, status_id, priority, created_at, updated_at)
      VALUES (?, ?, ?, 'backlog', ?, 'P1', datetime('now'), datetime('now'))
    `).run(ticketId, projectId, title, statusId || null);
    db.pragma('foreign_keys = ON');
  }

  describe('Migration: reassign orphaned tickets', () => {
    it('should reassign tickets with non-existent project_id during initialization', () => {
      // Insert an orphaned ticket with a non-existent project
      db.pragma('foreign_keys = OFF');
      db.prepare(`
        INSERT INTO ${T.tickets} (id, project_id, title, status, priority, created_at, updated_at)
        VALUES ('TKT-ORPHAN-1', 'nonexistent-project', 'Orphaned Ticket', 'backlog', 'P1', datetime('now'), datetime('now'))
      `).run();
      db.pragma('foreign_keys = ON');

      // Close and reopen db to trigger migration
      db.close();
      db = setupProductionSchema(env.dbPath, env.pmoPath);

      // The orphaned ticket should now be reassigned to PROJ-001
      const ticket = db.prepare(`
        SELECT project_id FROM ${T.tickets} WHERE id = 'TKT-ORPHAN-1'
      `).get() as { project_id: string } | undefined;

      expect(ticket).to.not.be.undefined;
      expect(ticket!.project_id).to.equal('PROJ-001');
    });

    it('should reassign tickets with default project_id when no default project exists', () => {
      // Insert an orphaned ticket with project_id = 'default'
      db.pragma('foreign_keys = OFF');
      db.prepare(`
        INSERT INTO ${T.tickets} (id, project_id, title, status, priority, created_at, updated_at)
        VALUES ('TKT-DEFAULT-1', 'default', 'Default Project Ticket', 'backlog', 'P2', datetime('now'), datetime('now'))
      `).run();
      db.pragma('foreign_keys = ON');

      // Close and reopen db to trigger migration
      db.close();
      db = setupProductionSchema(env.dbPath, env.pmoPath);

      // The orphaned ticket should now be reassigned to PROJ-001
      const ticket = db.prepare(`
        SELECT project_id FROM ${T.tickets} WHERE id = 'TKT-DEFAULT-1'
      `).get() as { project_id: string } | undefined;

      expect(ticket).to.not.be.undefined;
      expect(ticket!.project_id).to.equal('PROJ-001');
    });
  });

  describe('ticket view with orphaned project', () => {
    it('should display ticket without crashing when project is missing', () => {
      // Create a ticket in the valid project first, then orphan it
      insertOrphanedTicket('TKT-ORPHAN-VIEW', 'ghost-project', 'Orphaned View Test');

      const output = exec('ticket view TKT-ORPHAN-VIEW');

      // Should not crash - should show the ticket details
      expect(output).to.contain('TKT-ORPHAN-VIEW');
      expect(output).to.contain('Orphaned View Test');
    });
  });

  describe('ticket list with orphaned project', () => {
    it('should list tickets across all projects including orphaned ones', () => {
      // Create a valid ticket
      const defaultStatusId = db.prepare(`
        SELECT id FROM ${T.workflow_statuses}
        WHERE workflow_id = 'default' AND is_default = 1
      `).get() as { id: string };

      db.prepare(`
        INSERT INTO ${T.tickets} (id, project_id, title, status, status_id, priority, created_at, updated_at)
        VALUES ('TKT-VALID', 'PROJ-001', 'Valid Ticket', 'backlog', ?, 'P1', datetime('now'), datetime('now'))
      `).run(defaultStatusId.id);

      // Insert an orphaned ticket
      insertOrphanedTicket('TKT-ORPHAN-LIST', 'ghost-project', 'Orphaned List Test');

      const output = exec('ticket list --all');

      // Should show both tickets without crashing
      expect(output).to.contain('TKT-VALID');
      expect(output).to.contain('Valid Ticket');
      // Orphaned ticket should appear (may show under Unknown project)
      expect(output).to.contain('TKT-ORPHAN-LIST');
    });

    it('should handle --format json with orphaned tickets without crashing', () => {
      insertOrphanedTicket('TKT-ORPHAN-JSON', 'ghost-project', 'Orphaned JSON Test');

      const output = exec('ticket list --all --format json');

      // Should produce valid JSON output, not crash
      expect(output).to.not.contain('PMOError');
      expect(output).to.not.contain('Project not found');
    });
  });

  describe('ticket delete with orphaned project', () => {
    it('should allow deleting a ticket with orphaned project', () => {
      insertOrphanedTicket('TKT-ORPHAN-DEL', 'ghost-project', 'Orphaned Delete Test');

      const _output = exec('ticket delete TKT-ORPHAN-DEL --force');

      // Should delete without crashing
      const ticket = db.prepare(`
        SELECT id FROM ${T.tickets} WHERE id = 'TKT-ORPHAN-DEL'
      `).get();

      expect(ticket).to.be.undefined;
    });
  });
});
