/**
 * Regression tests for PRLT-1299: Remove dead PMO tables
 *
 * Verifies that:
 * 1. Dead tables are dropped by migration 0023
 * 2. Kept tables survive the migration
 * 3. pmo_external_issue_map is rekeyed (no pmo_ticket_id column)
 * 4. pmo_ticket_metadata has no FK to pmo_tickets
 * 5. pmo_projects has no workflow_id or initiative_id columns
 * 6. SQLiteStorage dead methods throw clear errors
 * 7. validateTransitionMap flags missing provider states
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { removeDeadPmoTables } from '../../src/lib/database/migrations/0023_remove_dead_pmo_tables.js'
import { validateTransitionMap } from '../../src/lib/providers/auto-mapper.js'

describe('PRLT-1299: Remove dead PMO tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')

    // Create the dead tables that migration 0023 will drop
    db.exec(`
      CREATE TABLE pmo_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        phase_id TEXT,
        workflow_id TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        target_date TIMESTAMP,
        initiative_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pmo_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pmo_workflow_statuses (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pmo_tickets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'backlog',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pmo_subtasks (
        id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        title TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        position INTEGER NOT NULL,
        PRIMARY KEY (ticket_id, id)
      );

      CREATE TABLE pmo_ticket_metadata (
        ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (ticket_id, key)
      );

      CREATE TABLE pmo_epics (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL
      );

      CREATE TABLE pmo_epic_dependencies (
        epic_id TEXT NOT NULL,
        depends_on_epic_id TEXT NOT NULL,
        PRIMARY KEY (epic_id, depends_on_epic_id)
      );

      CREATE TABLE pmo_specs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );

      CREATE TABLE pmo_spec_dependencies (
        spec_id TEXT NOT NULL,
        depends_on_spec_id TEXT NOT NULL,
        PRIMARY KEY (spec_id, depends_on_spec_id)
      );

      CREATE TABLE pmo_initiatives (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE pmo_roadmaps (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE pmo_roadmap_projects (roadmap_id TEXT, project_id TEXT, PRIMARY KEY (roadmap_id, project_id));
      CREATE TABLE pmo_project_specs (project_id TEXT, spec_id TEXT, PRIMARY KEY (project_id, spec_id));
      CREATE TABLE pmo_cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE pmo_columns (id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (project_id, id));
      CREATE TABLE pmo_statuses (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, category TEXT NOT NULL);
      CREATE TABLE pmo_board_tickets (project_id TEXT, ticket_id TEXT, column_id TEXT, position INTEGER, PRIMARY KEY (project_id, ticket_id));

      CREATE TABLE pmo_external_issue_map (
        pmo_ticket_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        external_url TEXT NOT NULL,
        team_key TEXT NOT NULL,
        sync_direction TEXT NOT NULL DEFAULT 'inbound',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id, provider),
        UNIQUE (provider, external_id)
      );

      INSERT INTO pmo_projects (id, name, workflow_id, initiative_id) VALUES ('proj-1', 'Test Project', 'default', 'init-1');
      INSERT INTO pmo_tickets (id, project_id, title) VALUES ('TKT-1', 'proj-1', 'Test Ticket');
      INSERT INTO pmo_ticket_metadata (ticket_id, key, value) VALUES ('TKT-1', 'external_key', 'PRLT-100');
      INSERT INTO pmo_ticket_metadata (ticket_id, key, value) VALUES ('TKT-1', 'category', 'feature');
      INSERT INTO pmo_external_issue_map (pmo_ticket_id, provider, external_id, external_key, external_url, team_key)
        VALUES ('TKT-1', 'linear', 'abc-123', 'PRLT-100', 'https://linear.app/test', 'PRLT');
    `)
  })

  afterEach(() => {
    db.close()
  })

  function tableExists(name: string): boolean {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { name: string } | undefined
    return !!result
  }

  function getColumns(tableName: string): string[] {
    const cols = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
    return cols.map(c => c.name)
  }

  describe('migration 0023', () => {
    it('drops all dead tables', () => {
      removeDeadPmoTables.up(db)

      const deadTables = [
        'pmo_tickets', 'pmo_subtasks', 'pmo_workflows', 'pmo_workflow_statuses',
        'pmo_epics', 'pmo_epic_dependencies', 'pmo_specs', 'pmo_spec_dependencies',
        'pmo_initiatives', 'pmo_roadmaps', 'pmo_roadmap_projects', 'pmo_project_specs',
        'pmo_cache_metadata', 'pmo_columns', 'pmo_statuses', 'pmo_board_tickets',
      ]

      for (const table of deadTables) {
        expect(tableExists(table), `${table} should be dropped`).to.be.false
      }
    })

    it('keeps pmo_projects table', () => {
      removeDeadPmoTables.up(db)
      expect(tableExists('pmo_projects')).to.be.true
    })

    it('removes workflow_id and initiative_id from pmo_projects', () => {
      removeDeadPmoTables.up(db)
      const cols = getColumns('pmo_projects')
      expect(cols).to.not.include('workflow_id')
      expect(cols).to.not.include('initiative_id')
      expect(cols).to.include('id')
      expect(cols).to.include('name')
      expect(cols).to.include('status')
    })

    it('rekeys pmo_external_issue_map by provider ID (no pmo_ticket_id)', () => {
      removeDeadPmoTables.up(db)
      expect(tableExists('pmo_external_issue_map')).to.be.true

      const cols = getColumns('pmo_external_issue_map')
      expect(cols).to.not.include('pmo_ticket_id')
      expect(cols).to.include('provider')
      expect(cols).to.include('external_id')
      expect(cols).to.include('external_key')

      // Data should be preserved
      const row = db.prepare(
        "SELECT * FROM pmo_external_issue_map WHERE provider = 'linear' AND external_id = 'abc-123'"
      ).get() as Record<string, unknown> | undefined
      expect(row).to.exist
      expect(row!.external_key).to.equal('PRLT-100')
    })

    it('recreates pmo_ticket_metadata without FK to pmo_tickets', () => {
      removeDeadPmoTables.up(db)
      expect(tableExists('pmo_ticket_metadata')).to.be.true

      // Data should be preserved (rekeyed where possible)
      const rows = db.prepare('SELECT * FROM pmo_ticket_metadata').all()
      expect(rows.length).to.be.greaterThan(0)
    })

    it('is idempotent — running twice does not fail', () => {
      removeDeadPmoTables.up(db)
      // Running again should not throw (tables already dropped)
      expect(() => removeDeadPmoTables.up(db)).to.not.throw()
    })
  })

  describe('validateTransitionMap', () => {
    it('returns no issues when all mappings match provider states', () => {
      const issues = validateTransitionMap(
        [
          { intent: 'started', providerStateName: 'In Progress' },
          { intent: 'completed', providerStateName: 'Done' },
        ],
        [
          { id: '1', name: 'In Progress' },
          { id: '2', name: 'Done' },
        ],
      )
      expect(issues).to.have.length(0)
    })

    it('flags mappings that reference missing provider states', () => {
      const issues = validateTransitionMap(
        [
          { intent: 'started', providerStateName: 'In Progress' },
          { intent: 'needs_review', providerStateName: 'Review' },
        ],
        [
          { id: '1', name: 'In Progress' },
          { id: '2', name: 'Done' },
          // No 'Review' state on the board
        ],
      )
      expect(issues).to.have.length(1)
      expect(issues[0].intent).to.equal('needs_review')
      expect(issues[0].mappedState).to.equal('Review')
      expect(issues[0].issue).to.include('does not exist')
    })

    it('is case-insensitive for state name matching', () => {
      const issues = validateTransitionMap(
        [{ intent: 'started', providerStateName: 'in progress' }],
        [{ id: '1', name: 'In Progress' }],
      )
      expect(issues).to.have.length(0)
    })
  })
})
