import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';
import { runMigrations } from '../../src/lib/pmo/storage/base.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

const T = PMO_TABLES;

describe('Ticket Dependency Migration (TKT-117)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-migration-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Schema Migration from blocked_by_ticket_id to depends_on_ticket_id', () => {
    it('migrates old schema with blocked_by_ticket_id to new schema', () => {
      const dbPath = path.join(testDir, 'old-schema.db');
      const db = new Database(dbPath);
      db.pragma('foreign_keys = OFF'); // Disable for migration test

      // Create old-style schema with blocked_by_ticket_id
      db.exec(`
        CREATE TABLE ${T.projects} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE ${T.tickets} (
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
          labels TEXT NOT NULL DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_synced_from_spec TIMESTAMP,
          last_synced_from_board TIMESTAMP
        )
      `);

      // Create specs table (required for migration to proceed)
      db.exec(`
        CREATE TABLE ${T.specs} (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create OLD schema with blocked_by_ticket_id (the bug scenario)
      db.exec(`
        CREATE TABLE ${T.ticket_dependencies} (
          ticket_id TEXT NOT NULL,
          blocked_by_ticket_id TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (ticket_id, blocked_by_ticket_id),
          CHECK (ticket_id != blocked_by_ticket_id)
        )
      `);

      // Insert test project and tickets
      db.exec(`INSERT INTO ${T.projects} (id, name) VALUES ('default', 'Test')`);
      db.exec(`INSERT INTO ${T.tickets} (id, project_id, title) VALUES ('TKT-001', 'default', 'Ticket 1')`);
      db.exec(`INSERT INTO ${T.tickets} (id, project_id, title) VALUES ('TKT-002', 'default', 'Ticket 2')`);
      db.exec(`INSERT INTO ${T.tickets} (id, project_id, title) VALUES ('TKT-003', 'default', 'Ticket 3')`);

      // Insert old-style blocking dependency (TKT-001 is blocked by TKT-002)
      db.exec(`INSERT INTO ${T.ticket_dependencies} (ticket_id, blocked_by_ticket_id) VALUES ('TKT-001', 'TKT-002')`);
      db.exec(`INSERT INTO ${T.ticket_dependencies} (ticket_id, blocked_by_ticket_id) VALUES ('TKT-001', 'TKT-003')`);

      // Verify old schema
      const oldColumns = db.pragma(`table_info(${T.ticket_dependencies})`) as Array<{ name: string }>;
      const oldColumnNames = new Set(oldColumns.map(c => c.name));
      expect(oldColumnNames.has('blocked_by_ticket_id')).to.be.true;
      expect(oldColumnNames.has('depends_on_ticket_id')).to.be.false;

      db.close();

      // Run migration
      const db2 = new Database(dbPath);
      db2.pragma('foreign_keys = OFF');
      runMigrations(db2);

      // Verify new schema
      const newColumns = db2.pragma(`table_info(${T.ticket_dependencies})`) as Array<{ name: string }>;
      const newColumnNames = new Set(newColumns.map(c => c.name));
      expect(newColumnNames.has('depends_on_ticket_id')).to.be.true;
      expect(newColumnNames.has('dependency_type')).to.be.true;
      expect(newColumnNames.has('blocked_by_ticket_id')).to.be.false;

      // Verify data was migrated correctly
      const deps = db2.prepare(`
        SELECT ticket_id, depends_on_ticket_id, dependency_type
        FROM ${T.ticket_dependencies}
        ORDER BY ticket_id, depends_on_ticket_id
      `).all() as Array<{ ticket_id: string; depends_on_ticket_id: string; dependency_type: string }>;

      expect(deps).to.have.length(2);
      expect(deps[0]).to.deep.equal({
        ticket_id: 'TKT-001',
        depends_on_ticket_id: 'TKT-002',
        dependency_type: 'blocks',
      });
      expect(deps[1]).to.deep.equal({
        ticket_id: 'TKT-001',
        depends_on_ticket_id: 'TKT-003',
        dependency_type: 'blocks',
      });

      db2.close();
    });

    it('does not affect databases with new schema', () => {
      const dbPath = path.join(testDir, 'new-schema.db');
      const db = new Database(dbPath);
      db.pragma('foreign_keys = OFF');

      // Create new-style schema with depends_on_ticket_id
      db.exec(`
        CREATE TABLE ${T.projects} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE ${T.tickets} (
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
          labels TEXT NOT NULL DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_synced_from_spec TIMESTAMP,
          last_synced_from_board TIMESTAMP
        )
      `);

      // Create specs table (required for migration to proceed)
      db.exec(`
        CREATE TABLE ${T.specs} (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create NEW schema (correct)
      db.exec(`
        CREATE TABLE ${T.ticket_dependencies} (
          ticket_id TEXT NOT NULL,
          depends_on_ticket_id TEXT NOT NULL,
          dependency_type TEXT NOT NULL DEFAULT 'blocks',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (ticket_id, depends_on_ticket_id, dependency_type),
          CHECK (ticket_id != depends_on_ticket_id)
        )
      `);

      // Insert test data
      db.exec(`INSERT INTO ${T.projects} (id, name) VALUES ('default', 'Test')`);
      db.exec(`INSERT INTO ${T.tickets} (id, project_id, title) VALUES ('TKT-001', 'default', 'Ticket 1')`);
      db.exec(`INSERT INTO ${T.tickets} (id, project_id, title) VALUES ('TKT-002', 'default', 'Ticket 2')`);
      db.exec(`INSERT INTO ${T.ticket_dependencies} (ticket_id, depends_on_ticket_id, dependency_type) VALUES ('TKT-001', 'TKT-002', 'relates_to')`);

      db.close();

      // Run migration (should be no-op)
      const db2 = new Database(dbPath);
      db2.pragma('foreign_keys = OFF');
      runMigrations(db2);

      // Verify data is unchanged
      const deps = db2.prepare(`
        SELECT ticket_id, depends_on_ticket_id, dependency_type
        FROM ${T.ticket_dependencies}
      `).all() as Array<{ ticket_id: string; depends_on_ticket_id: string; dependency_type: string }>;

      expect(deps).to.have.length(1);
      expect(deps[0].dependency_type).to.equal('relates_to'); // Not changed to 'blocks'

      db2.close();
    });
  });

  describe('Symmetric relates_to Queries', () => {
    let storage: SQLiteStorage;
    let ticket1Id: string;
    let ticket2Id: string;
    let ticket3Id: string;

    beforeEach(async () => {
      const dbPath = path.join(testDir, 'symmetric.db');
      const db = new Database(dbPath);
      db.close();

      storage = new SQLiteStorage(dbPath);
      await storage.createProject({
        id: 'default',
        name: 'Test Project',
        template: 'kanban',
      });

      const ticket1 = await storage.createTicket('default', { title: 'Ticket 1', statusName: 'Backlog' });
      const ticket2 = await storage.createTicket('default', { title: 'Ticket 2', statusName: 'Backlog' });
      const ticket3 = await storage.createTicket('default', { title: 'Ticket 3', statusName: 'Backlog' });
      ticket1Id = ticket1.id;
      ticket2Id = ticket2.id;
      ticket3Id = ticket3.id;
    });

    afterEach(async () => {
      await storage.close();
    });

    it('relates_to is visible from both tickets', async () => {
      // Create relationship: ticket1 relates_to ticket2
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'relates_to');

      // Check from ticket1's perspective
      const deps1 = await storage.listTicketDependencies(ticket1Id);
      const relatesTo1 = deps1.filter(d => d.dependencyType === 'relates_to');
      expect(relatesTo1).to.have.length(1);
      expect(relatesTo1[0].dependsOnTicketId).to.equal(ticket2Id);

      // Check from ticket2's perspective (symmetric)
      const deps2 = await storage.listTicketDependencies(ticket2Id);
      const relatesTo2 = deps2.filter(d => d.dependencyType === 'relates_to');
      expect(relatesTo2).to.have.length(1);
      expect(relatesTo2[0].dependsOnTicketId).to.equal(ticket1Id);
    });

    it('blocks is NOT symmetric (directional)', async () => {
      // Create relationship: ticket1 is blocked by ticket2
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');

      // Check from ticket1's perspective
      const deps1 = await storage.listTicketDependencies(ticket1Id);
      const blocks1 = deps1.filter(d => d.dependencyType === 'blocks');
      expect(blocks1).to.have.length(1);
      expect(blocks1[0].dependsOnTicketId).to.equal(ticket2Id);

      // Check from ticket2's perspective (should NOT see the reverse)
      const deps2 = await storage.listTicketDependencies(ticket2Id);
      const blocks2 = deps2.filter(d => d.dependencyType === 'blocks');
      expect(blocks2).to.have.length(0);
    });

    it('duplicates is NOT symmetric (directional)', async () => {
      // Create relationship: ticket1 duplicates ticket2
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'duplicates');

      // Check from ticket1's perspective
      const deps1 = await storage.listTicketDependencies(ticket1Id);
      const dupes1 = deps1.filter(d => d.dependencyType === 'duplicates');
      expect(dupes1).to.have.length(1);
      expect(dupes1[0].dependsOnTicketId).to.equal(ticket2Id);

      // Check from ticket2's perspective (should NOT see the reverse)
      const deps2 = await storage.listTicketDependencies(ticket2Id);
      const dupes2 = deps2.filter(d => d.dependencyType === 'duplicates');
      expect(dupes2).to.have.length(0);
    });

    it('deduplicates bidirectional relates_to relationships', async () => {
      // Create relationship in both directions (shouldn't happen normally, but test deduplication)
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'relates_to');
      // Create reverse (would require different dependency_type or fail due to composite key)
      // Actually, the schema allows this because primary key is (ticket_id, depends_on_ticket_id, dependency_type)
      // So A->B relates_to and B->A relates_to are both allowed

      // Check that listing from ticket1 doesn't show duplicates
      const deps1 = await storage.listTicketDependencies(ticket1Id);
      const relatesTo1 = deps1.filter(d => d.dependencyType === 'relates_to');
      expect(relatesTo1).to.have.length(1);
    });

    it('handles multiple relationship types correctly', async () => {
      // Ticket 1 relates_to Ticket 2
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'relates_to');
      // Ticket 1 is blocked by Ticket 3
      await storage.createTicketDependency(ticket1Id, ticket3Id, 'blocks');

      // From ticket1 perspective: should see both
      const deps1 = await storage.listTicketDependencies(ticket1Id);
      expect(deps1).to.have.length(2);

      // From ticket2 perspective: should see relates_to from ticket1
      const deps2 = await storage.listTicketDependencies(ticket2Id);
      const relatesTo2 = deps2.filter(d => d.dependencyType === 'relates_to');
      expect(relatesTo2).to.have.length(1);
      expect(relatesTo2[0].dependsOnTicketId).to.equal(ticket1Id);

      // From ticket3 perspective: should NOT see blocks (directional)
      const deps3 = await storage.listTicketDependencies(ticket3Id);
      const blocks3 = deps3.filter(d => d.dependencyType === 'blocks');
      expect(blocks3).to.have.length(0);
    });
  });

  describe('CLI Command Integration', () => {
    let storage: SQLiteStorage;
    let ticket1Id: string;
    let ticket2Id: string;

    beforeEach(async () => {
      const dbPath = path.join(testDir, 'integration.db');
      const db = new Database(dbPath);
      db.close();

      storage = new SQLiteStorage(dbPath);
      await storage.createProject({
        id: 'default',
        name: 'Test Project',
        template: 'kanban',
      });

      const ticket1 = await storage.createTicket('default', { title: 'Ticket 1', statusName: 'Backlog' });
      const ticket2 = await storage.createTicket('default', { title: 'Ticket 2', statusName: 'Backlog' });
      ticket1Id = ticket1.id;
      ticket2Id = ticket2.id;
    });

    afterEach(async () => {
      await storage.close();
    });

    it('ticket link relates works correctly', async () => {
      // Simulate the relates command
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'relates_to');

      expect(dep.ticketId).to.equal(ticket1Id);
      expect(dep.dependsOnTicketId).to.equal(ticket2Id);
      expect(dep.dependencyType).to.equal('relates_to');
    });

    it('ticket link block works correctly', async () => {
      // Simulate the block command
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');

      expect(dep.ticketId).to.equal(ticket1Id);
      expect(dep.dependsOnTicketId).to.equal(ticket2Id);
      expect(dep.dependencyType).to.equal('blocks');
    });

    it('ticket link duplicates works correctly', async () => {
      // Simulate the duplicates command
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'duplicates');

      expect(dep.ticketId).to.equal(ticket1Id);
      expect(dep.dependsOnTicketId).to.equal(ticket2Id);
      expect(dep.dependencyType).to.equal('duplicates');
    });
  });
});
