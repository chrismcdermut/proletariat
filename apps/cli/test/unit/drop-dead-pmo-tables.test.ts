import { expect } from 'chai'
import Database from 'better-sqlite3'
import { dropDeadPmoTables } from '../../src/lib/database/migrations/0024_drop_dead_pmo_tables.js'
import { validateTransitionMap, TransitionMapStore } from '../../src/lib/providers/transition-map.js'

// =============================================================================
// Migration 0024: Drop Dead PMO Tables — PRLT-1299
// =============================================================================

describe('Migration 0024: Drop Dead PMO Tables (PRLT-1299)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Create the dead tables that should be dropped
    db.exec(`
      CREATE TABLE pmo_tickets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'backlog'
      );
      CREATE TABLE pmo_subtasks (
        id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (ticket_id, id)
      );
      CREATE TABLE pmo_ticket_acceptance_criteria (
        id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        criterion TEXT NOT NULL,
        PRIMARY KEY (ticket_id, id)
      );
      CREATE TABLE pmo_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE pmo_workflow_statuses (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE pmo_columns (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (project_id, id)
      );
      CREATE TABLE pmo_statuses (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE pmo_epics (
        id TEXT PRIMARY KEY,
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
      CREATE TABLE pmo_linear_issue_map (pmo_ticket_id TEXT PRIMARY KEY, linear_issue_id TEXT NOT NULL);
      CREATE TABLE pmo_monday_item_map (pmo_ticket_id TEXT PRIMARY KEY, monday_item_id TEXT NOT NULL);
      CREATE TABLE pmo_provider_status_map (provider TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (provider, status));
      CREATE TABLE pmo_provider_triggers (id INTEGER PRIMARY KEY, event TEXT NOT NULL);
      CREATE TABLE pmo_ticket_labels (ticket_id TEXT, label_id TEXT, PRIMARY KEY (ticket_id, label_id));
      CREATE TABLE pmo_ticket_assignments (ticket_id TEXT, agent_name TEXT, PRIMARY KEY (ticket_id, agent_name));
      CREATE TABLE pmo_ticket_dependencies (ticket_id TEXT, depends_on TEXT, PRIMARY KEY (ticket_id, depends_on));
      CREATE TABLE pmo_ticket_affected_paths (id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL);
      CREATE TABLE pmo_ticket_specs (ticket_id TEXT, spec_id TEXT, PRIMARY KEY (ticket_id, spec_id));
      CREATE TABLE pmo_board_tickets (project_id TEXT, ticket_id TEXT, PRIMARY KEY (project_id, ticket_id));
      CREATE TABLE pmo_board_views (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
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

  it('drops all dead tables', () => {
    // Verify tables exist before migration
    expect(tableExists('pmo_tickets')).to.be.true
    expect(tableExists('pmo_subtasks')).to.be.true
    expect(tableExists('pmo_workflows')).to.be.true
    expect(tableExists('pmo_workflow_statuses')).to.be.true
    expect(tableExists('pmo_epics')).to.be.true
    expect(tableExists('pmo_specs')).to.be.true
    expect(tableExists('pmo_cache_metadata')).to.be.true

    // Run migration
    dropDeadPmoTables.up(db)

    // Verify all dead tables are gone
    expect(tableExists('pmo_tickets')).to.be.false
    expect(tableExists('pmo_subtasks')).to.be.false
    expect(tableExists('pmo_ticket_acceptance_criteria')).to.be.false
    expect(tableExists('pmo_workflows')).to.be.false
    expect(tableExists('pmo_workflow_statuses')).to.be.false
    expect(tableExists('pmo_columns')).to.be.false
    expect(tableExists('pmo_statuses')).to.be.false
    expect(tableExists('pmo_epics')).to.be.false
    expect(tableExists('pmo_epic_dependencies')).to.be.false
    expect(tableExists('pmo_specs')).to.be.false
    expect(tableExists('pmo_spec_dependencies')).to.be.false
    expect(tableExists('pmo_initiatives')).to.be.false
    expect(tableExists('pmo_roadmaps')).to.be.false
    expect(tableExists('pmo_roadmap_projects')).to.be.false
    expect(tableExists('pmo_project_specs')).to.be.false
    expect(tableExists('pmo_cache_metadata')).to.be.false
    expect(tableExists('pmo_linear_issue_map')).to.be.false
    expect(tableExists('pmo_monday_item_map')).to.be.false
    expect(tableExists('pmo_provider_status_map')).to.be.false
    expect(tableExists('pmo_provider_triggers')).to.be.false
    expect(tableExists('pmo_ticket_labels')).to.be.false
    expect(tableExists('pmo_ticket_assignments')).to.be.false
    expect(tableExists('pmo_ticket_dependencies')).to.be.false
    expect(tableExists('pmo_ticket_affected_paths')).to.be.false
    expect(tableExists('pmo_ticket_specs')).to.be.false
    expect(tableExists('pmo_board_tickets')).to.be.false
    expect(tableExists('pmo_board_views')).to.be.false
  })

  it('is idempotent — running twice does not error', () => {
    dropDeadPmoTables.up(db)
    dropDeadPmoTables.up(db)  // Should not throw
    expect(tableExists('pmo_tickets')).to.be.false
  })

  it('works when some tables are already missing', () => {
    // Drop some tables first
    db.exec('DROP TABLE pmo_tickets')
    db.exec('DROP TABLE pmo_epics')

    // Migration should still succeed
    dropDeadPmoTables.up(db)
    expect(tableExists('pmo_workflows')).to.be.false
    expect(tableExists('pmo_specs')).to.be.false
  })

  describe('pmo_external_issue_map rekeying', () => {
    it('drops pmo_ticket_id column and rekeys by (provider, external_id)', () => {
      // Create old-format table with pmo_ticket_id
      db.exec(`
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
        )
      `)

      // Insert test data
      db.prepare(`
        INSERT INTO pmo_external_issue_map
          (pmo_ticket_id, provider, external_id, external_key, external_url, team_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('TKT-1', 'linear', 'lin-123', 'PRLT-100', 'https://linear.app/issue/PRLT-100', 'PRLT')

      // Run migration
      dropDeadPmoTables.up(db)

      // Verify table still exists
      expect(tableExists('pmo_external_issue_map')).to.be.true

      // Verify pmo_ticket_id column is gone
      const cols = db.pragma('table_info(pmo_external_issue_map)') as { name: string }[]
      const colNames = cols.map(c => c.name)
      expect(colNames).to.not.include('pmo_ticket_id')

      // Verify data was preserved
      const row = db.prepare(
        'SELECT * FROM pmo_external_issue_map WHERE provider = ? AND external_id = ?'
      ).get('linear', 'lin-123') as { external_key: string; team_key: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.external_key).to.equal('PRLT-100')
      expect(row!.team_key).to.equal('PRLT')
    })

    it('preserves data when table already has new schema', () => {
      // Create new-format table (no pmo_ticket_id)
      db.exec(`
        CREATE TABLE pmo_external_issue_map (
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (provider, external_id)
        )
      `)

      db.prepare(`
        INSERT INTO pmo_external_issue_map
          (provider, external_id, external_key, external_url, team_key)
        VALUES (?, ?, ?, ?, ?)
      `).run('linear', 'lin-456', 'PRLT-200', 'https://linear.app/issue/PRLT-200', 'PRLT')

      // Run migration — should be no-op for this table
      dropDeadPmoTables.up(db)

      const row = db.prepare(
        'SELECT * FROM pmo_external_issue_map WHERE provider = ? AND external_id = ?'
      ).get('linear', 'lin-456') as { external_key: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.external_key).to.equal('PRLT-200')
    })
  })

  describe('pmo_ticket_metadata rekeying', () => {
    it('removes FK constraint on ticket_id', () => {
      // Insert a ticket row first so the FK is satisfied during INSERT
      db.prepare(`INSERT INTO pmo_tickets (id, title) VALUES (?, ?)`).run('TKT-1', 'Test')

      // Create old table with FK to tickets
      db.exec(`
        CREATE TABLE pmo_ticket_metadata (
          ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (ticket_id, key)
        )
      `)

      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value) VALUES (?, ?, ?)
      `).run('TKT-1', 'external_key', 'PRLT-100')

      // Run migration
      dropDeadPmoTables.up(db)

      // pmo_tickets is gone but pmo_ticket_metadata should survive
      expect(tableExists('pmo_tickets')).to.be.false
      expect(tableExists('pmo_ticket_metadata')).to.be.true

      // Verify data preserved
      const row = db.prepare(
        'SELECT * FROM pmo_ticket_metadata WHERE ticket_id = ? AND key = ?'
      ).get('TKT-1', 'external_key') as { value: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.value).to.equal('PRLT-100')
    })
  })
})

// =============================================================================
// Transition Map Validation — PRLT-1299
// =============================================================================

describe('validateTransitionMap (PRLT-1299)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE pmo_transition_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        intent TEXT NOT NULL,
        provider_state_name TEXT NOT NULL,
        provider_state_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, intent)
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('reports valid mappings when states exist', () => {
    const store = new TransitionMapStore(db)
    store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })
    store.upsertMapping({ provider: 'linear', intent: 'completed', providerStateName: 'Done' })

    const result = validateTransitionMap(db, 'linear', ['In Progress', 'Done', 'Backlog'])
    expect(result.valid).to.have.lengthOf(2)
    expect(result.missing).to.have.lengthOf(0)
  })

  it('reports missing mappings when states do not exist on provider', () => {
    const store = new TransitionMapStore(db)
    store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })
    store.upsertMapping({ provider: 'linear', intent: 'needs_review', providerStateName: 'Review' })

    // Provider doesn't have 'Review' state
    const result = validateTransitionMap(db, 'linear', ['In Progress', 'Done', 'Backlog'])
    expect(result.valid).to.have.lengthOf(1)
    expect(result.valid[0].intent).to.equal('started')
    expect(result.missing).to.have.lengthOf(1)
    expect(result.missing[0].intent).to.equal('needs_review')
    expect(result.missing[0].providerStateName).to.equal('Review')
  })

  it('reports unmapped intents', () => {
    const store = new TransitionMapStore(db)
    store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'In Progress' })

    const result = validateTransitionMap(db, 'linear', ['In Progress', 'Done'])
    expect(result.unmappedIntents).to.include('backlog')
    expect(result.unmappedIntents).to.include('ready')
    expect(result.unmappedIntents).to.include('needs_review')
    expect(result.unmappedIntents).to.include('completed')
    expect(result.unmappedIntents).to.not.include('started')
  })

  it('is case-insensitive for state name matching', () => {
    const store = new TransitionMapStore(db)
    store.upsertMapping({ provider: 'linear', intent: 'started', providerStateName: 'in progress' })

    const result = validateTransitionMap(db, 'linear', ['In Progress'])
    expect(result.valid).to.have.lengthOf(1)
    expect(result.missing).to.have.lengthOf(0)
  })

  it('handles empty transition map gracefully', () => {
    const result = validateTransitionMap(db, 'linear', ['In Progress', 'Done'])
    expect(result.valid).to.have.lengthOf(0)
    expect(result.missing).to.have.lengthOf(0)
    expect(result.unmappedIntents).to.have.lengthOf(5)
  })
})
