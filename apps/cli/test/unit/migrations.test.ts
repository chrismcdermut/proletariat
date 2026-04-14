import { expect } from 'chai'
import Database from 'better-sqlite3'
import { runDrizzleMigrations, type Migration } from '../../src/lib/database/migrator.js'
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js'

describe('Database Migration System', () => {
  function openDb(): Database.Database {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    return db
  }

  function getAppliedMigrations(db: Database.Database): { id: string; name: string }[] {
    return db.prepare('SELECT id, name FROM prlt_migrations ORDER BY id').all() as { id: string; name: string }[]
  }

  function tableExists(db: Database.Database, tableName: string): boolean {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName)
    return !!row
  }

  function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
    return info.some(col => col.name === columnName)
  }

  describe('runDrizzleMigrations', () => {
    it('creates the prlt_migrations tracking table', () => {
      const db = openDb()
      runDrizzleMigrations(db, [])
      expect(tableExists(db, 'prlt_migrations')).to.be.true
      db.close()
    })

    it('applies migrations in order', () => {
      const applied: string[] = []
      const migrations: Migration[] = [
        { id: '0001', name: 'first', up: () => { applied.push('first') } },
        { id: '0002', name: 'second', up: () => { applied.push('second') } },
        { id: '0003', name: 'third', up: () => { applied.push('third') } },
      ]

      const db = openDb()
      runDrizzleMigrations(db, migrations)

      expect(applied).to.deep.equal(['first', 'second', 'third'])
      expect(getAppliedMigrations(db)).to.deep.equal([
        { id: '0001', name: 'first' },
        { id: '0002', name: 'second' },
        { id: '0003', name: 'third' },
      ])
      db.close()
    })

    it('skips already-applied migrations', () => {
      const applied: string[] = []
      const migrations: Migration[] = [
        { id: '0001', name: 'first', up: () => { applied.push('first') } },
        { id: '0002', name: 'second', up: () => { applied.push('second') } },
      ]

      const db = openDb()

      // Run once
      runDrizzleMigrations(db, migrations)
      expect(applied).to.deep.equal(['first', 'second'])

      // Run again — should skip both
      applied.length = 0
      runDrizzleMigrations(db, migrations)
      expect(applied).to.deep.equal([])
      expect(getAppliedMigrations(db)).to.have.length(2)
      db.close()
    })

    it('applies only new migrations on subsequent runs', () => {
      const applied: string[] = []

      const db = openDb()

      // First run with 1 migration
      runDrizzleMigrations(db, [
        { id: '0001', name: 'first', up: () => { applied.push('first') } },
      ])
      expect(applied).to.deep.equal(['first'])

      // Second run with an additional migration
      applied.length = 0
      runDrizzleMigrations(db, [
        { id: '0001', name: 'first', up: () => { applied.push('first') } },
        { id: '0002', name: 'second', up: () => { applied.push('second') } },
      ])
      expect(applied).to.deep.equal(['second'])
      db.close()
    })

    it('rolls back a failed migration without recording it', () => {
      const db = openDb()

      const migrations: Migration[] = [
        {
          id: '0001',
          name: 'good',
          up: (d) => { d.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)') },
        },
        {
          id: '0002',
          name: 'bad',
          up: () => { throw new Error('migration failed') },
        },
      ]

      expect(() => runDrizzleMigrations(db, migrations)).to.throw('migration failed')

      // First migration should have been applied
      expect(getAppliedMigrations(db)).to.deep.equal([{ id: '0001', name: 'good' }])
      expect(tableExists(db, 'test_table')).to.be.true
      db.close()
    })
  })

  describe('ALL_MIGRATIONS on a fresh database', () => {
    it('creates all expected workspace tables', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const expectedTables = [
        'workspace', 'repositories', 'agent_themes', 'agent_theme_names',
        'agents', 'agent_worktrees', 'workspace_settings', 'media_items',
        'prlt_migrations',
      ]
      for (const table of expectedTables) {
        expect(tableExists(db, table), `table ${table} should exist`).to.be.true
      }
      db.close()
    })

    it('creates agents table with mount_mode column', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)
      expect(columnExists(db, 'agents', 'mount_mode')).to.be.true
      db.close()
    })

    it('creates agent_worktrees with tracking columns', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)
      expect(columnExists(db, 'agent_worktrees', 'commits_ahead')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'is_clean')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'last_checked')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'last_commit_hash')).to.be.true
      db.close()
    })

    it('records all migrations as applied', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)
      const applied = getAppliedMigrations(db)
      expect(applied).to.have.length(ALL_MIGRATIONS.length)
      expect(applied.map(m => m.id)).to.deep.equal(ALL_MIGRATIONS.map(m => m.id))
      db.close()
    })
  })

  describe('ALL_MIGRATIONS on an existing pre-migration database', () => {
    /**
     * Simulates an existing database that was created before the migration
     * system was introduced. It has the old schema (e.g., agent_theme_names
     * with a 'used' column, agents without mount_mode, etc.).
     */
    function createLegacyDatabase(): Database.Database {
      const db = openDb()
      db.pragma('foreign_keys = ON')

      // Create old-style tables (without mount_mode, without worktree tracking cols)
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE repositories (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT DEFAULT 'main' CHECK (type IN ('main', 'dependency')),
          source_url TEXT,
          action TEXT CHECK (action IN ('clone', 'move', 'link')),
          added_at TEXT NOT NULL
        );

        CREATE TABLE agent_themes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          builtin BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE agent_theme_names (
          theme_id TEXT NOT NULL,
          name TEXT NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          PRIMARY KEY (theme_id, name),
          FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
        );

        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleaned')),
          base_name TEXT,
          theme_id TEXT,
          worktree_path TEXT,
          created_at TEXT NOT NULL,
          cleaned_at TEXT,
          FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
        );

        CREATE TABLE agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (agent_name, repo_name),
          FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
          FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
        );

        CREATE TABLE workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
        VALUES (1, 'hq', 'test-workspace', 0, '2024-01-01T00:00:00.000Z');
      `)

      return db
    }

    it('upgrades legacy database: drops used column from agent_theme_names', () => {
      const db = createLegacyDatabase()
      expect(columnExists(db, 'agent_theme_names', 'used')).to.be.true

      runDrizzleMigrations(db, ALL_MIGRATIONS)

      expect(columnExists(db, 'agent_theme_names', 'used')).to.be.false
      expect(columnExists(db, 'agent_theme_names', 'theme_id')).to.be.true
      expect(columnExists(db, 'agent_theme_names', 'name')).to.be.true
      db.close()
    })

    it('upgrades legacy database: adds worktree tracking columns', () => {
      const db = createLegacyDatabase()
      expect(columnExists(db, 'agent_worktrees', 'commits_ahead')).to.be.false

      runDrizzleMigrations(db, ALL_MIGRATIONS)

      expect(columnExists(db, 'agent_worktrees', 'commits_ahead')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'is_clean')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'last_checked')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'last_commit_hash')).to.be.true
      db.close()
    })

    it('upgrades legacy database: adds mount_mode column', () => {
      const db = createLegacyDatabase()
      expect(columnExists(db, 'agents', 'mount_mode')).to.be.false

      runDrizzleMigrations(db, ALL_MIGRATIONS)

      expect(columnExists(db, 'agents', 'mount_mode')).to.be.true
      db.close()
    })

    it('upgrades legacy database: creates media_items table', () => {
      const db = createLegacyDatabase()
      expect(tableExists(db, 'media_items')).to.be.false

      runDrizzleMigrations(db, ALL_MIGRATIONS)

      expect(tableExists(db, 'media_items')).to.be.true
      db.close()
    })

    it('preserves existing data during migration', () => {
      const db = createLegacyDatabase()

      // Insert a theme with a 'used' name
      db.exec(`
        INSERT INTO agent_themes (id, name, display_name, builtin, created_at)
        VALUES ('theme1', 'test', 'Test Theme', 1, '2024-01-01T00:00:00.000Z')
      `)
      db.exec(`
        INSERT INTO agent_theme_names (theme_id, name, used)
        VALUES ('theme1', 'alice', 1)
      `)

      runDrizzleMigrations(db, ALL_MIGRATIONS)

      // Theme name should still be there (but without 'used' column)
      const names = db.prepare(
        'SELECT theme_id, name FROM agent_theme_names WHERE theme_id = ?'
      ).all('theme1') as { theme_id: string; name: string }[]
      expect(names).to.have.length(1)
      expect(names[0].name).to.equal('alice')
      db.close()
    })
  })

  describe('idempotency', () => {
    it('running all migrations twice produces the same result', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)
      const firstRun = getAppliedMigrations(db)

      // Run again
      runDrizzleMigrations(db, ALL_MIGRATIONS)
      const secondRun = getAppliedMigrations(db)

      expect(firstRun).to.deep.equal(secondRun)
      db.close()
    })
  })

  describe('0016_schema_catchup', () => {
    function getTableNames(db: Database.Database): string[] {
      const rows = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as { name: string }[]
      return rows.map(r => r.name)
    }

    function getTableColumns(db: Database.Database, table: string): string[] {
      const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]
      return rows.map(r => r.name).sort()
    }

    function getIndexNames(db: Database.Database): string[] {
      const rows = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as { name: string }[]
      return rows.map(r => r.name)
    }

    it('fresh DB: all migrations produce expected tables', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const tables = getTableNames(db)

      // Core workspace tables
      for (const t of ['workspace', 'repositories', 'agents', 'agent_worktrees',
        'agent_themes', 'agent_theme_names', 'workspace_settings', 'media_items']) {
        expect(tables, `missing table: ${t}`).to.include(t)
      }

      // PMO tables (PRLT-1299: dead tables removed — pmo_tickets, pmo_workflows,
      // pmo_workflow_statuses, pmo_labels, pmo_label_groups, pmo_ticket_labels,
      // pmo_roadmaps, pmo_roadmap_projects dropped)
      for (const t of ['pmo_projects', 'pmo_actions',
        'pmo_workflow_rules', 'pmo_work_hooks', 'agent_work',
        'containers', 'pmo_external_issue_map',
        'pmo_external_execution_map', 'pmo_ticket_templates']) {
        expect(tables, `missing table: ${t}`).to.include(t)
      }

      db.close()
    })

    it('fresh DB: agents table has all expected columns', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const cols = getTableColumns(db, 'agents')
      for (const c of ['name', 'type', 'status', 'base_name', 'theme_id',
        'worktree_path', 'mount_mode', 'created_at', 'cleaned_at']) {
        expect(cols, `missing column: agents.${c}`).to.include(c)
      }

      db.close()
    })

    it('fresh DB: agent_work table has lifecycle columns', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const cols = getTableColumns(db, 'agent_work')
      for (const c of ['last_heartbeat', 'retries', 'lifecycle_state',
        'external_source', 'external_key', 'external_id', 'external_url',
        'cleanup_policy', 'session_id', 'host']) {
        expect(cols, `missing column: agent_work.${c}`).to.include(c)
      }

      db.close()
    })

    it('fresh DB: pmo_work_hooks has orchestrate columns', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const cols = getTableColumns(db, 'pmo_work_hooks')
      for (const c of ['mode', 'priority', 'project_id', 'source', 'config']) {
        expect(cols, `missing column: pmo_work_hooks.${c}`).to.include(c)
      }

      db.close()
    })

    it('catch-up recovers a mid-version DB missing tables and columns', () => {
      const db = openDb()

      // Simulate a v0.3.80-era database: only core workspace tables,
      // basic PMO tables, no newer tables/columns
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE repositories (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT DEFAULT 'main',
          source_url TEXT,
          action TEXT,
          added_at TEXT NOT NULL
        );
        CREATE TABLE agent_themes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          builtin BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE agent_theme_names (
          theme_id TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (theme_id, name),
          FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
        );
        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          base_name TEXT,
          theme_id TEXT,
          worktree_path TEXT,
          created_at TEXT NOT NULL,
          cleaned_at TEXT
        );
        CREATE TABLE agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (agent_name, repo_name)
        );
        CREATE TABLE workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE pmo_projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          template TEXT,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE pmo_tickets (
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE pmo_actions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          prompt TEXT NOT NULL,
          end_prompt TEXT,
          modifies_code INTEGER NOT NULL DEFAULT 1,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE agent_work (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          executor TEXT NOT NULL,
          environment TEXT NOT NULL DEFAULT 'host',
          display_mode TEXT NOT NULL DEFAULT 'terminal',
          permission_mode TEXT NOT NULL DEFAULT 'safe',
          status TEXT NOT NULL DEFAULT 'starting',
          branch TEXT,
          pid TEXT,
          container_id TEXT,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          exit_code INTEGER,
          error_message TEXT,
          log_path TEXT
        );
        CREATE TABLE pmo_work_hooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          event TEXT NOT NULL,
          action_type TEXT NOT NULL,
          action_value TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE containers (
          id TEXT PRIMARY KEY,
          agent_name TEXT NOT NULL,
          docker_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
        VALUES (1, 'hq', 'test-workspace', 1, '2024-01-01T00:00:00.000Z');
      `)

      // Manually mark 0001 through 0005 as already applied (simulating partial upgrade)
      db.exec(`
        CREATE TABLE IF NOT EXISTS prlt_migrations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO prlt_migrations (id, name, applied_at) VALUES
          ('0001', 'baseline', '2024-01-01T00:00:00.000Z'),
          ('0002', 'work_hooks', '2024-01-01T00:00:00.000Z'),
          ('0003', 'actions_redesign', '2024-01-01T00:00:00.000Z'),
          ('0004', 'workflow_rules', '2024-01-01T00:00:00.000Z'),
          ('0005', 'provider_status_mapping', '2024-01-01T00:00:00.000Z');
      `)

      // Verify some columns/tables are missing before catch-up
      expect(columnExists(db, 'agents', 'mount_mode')).to.be.false
      expect(columnExists(db, 'agent_worktrees', 'commits_ahead')).to.be.false
      expect(columnExists(db, 'agent_work', 'lifecycle_state')).to.be.false
      expect(columnExists(db, 'pmo_work_hooks', 'mode')).to.be.false
      expect(tableExists(db, 'media_items')).to.be.false

      // Run remaining migrations (0006+ including catch-up and PRLT-1299 drop)
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      // All surviving columns should now exist
      expect(columnExists(db, 'agents', 'mount_mode')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'commits_ahead')).to.be.true
      expect(columnExists(db, 'agent_worktrees', 'is_clean')).to.be.true
      expect(columnExists(db, 'pmo_actions', 'review_gate')).to.be.true
      expect(columnExists(db, 'pmo_actions', 'network_allowlist')).to.be.true
      expect(columnExists(db, 'agent_work', 'lifecycle_state')).to.be.true
      expect(columnExists(db, 'agent_work', 'cleanup_policy')).to.be.true
      expect(columnExists(db, 'pmo_work_hooks', 'mode')).to.be.true
      expect(columnExists(db, 'pmo_work_hooks', 'source')).to.be.true
      expect(columnExists(db, 'containers', 'image')).to.be.true

      // Missing tables should have been created (then some dropped by PRLT-1299)
      expect(tableExists(db, 'media_items')).to.be.true
      expect(tableExists(db, 'pmo_ticket_templates')).to.be.true
      expect(tableExists(db, 'pmo_external_issue_map')).to.be.true

      // PRLT-1299: Dead tables dropped by migration 0024
      expect(tableExists(db, 'pmo_tickets')).to.be.false
      expect(tableExists(db, 'pmo_workflows')).to.be.false
      expect(tableExists(db, 'pmo_workflow_statuses')).to.be.false
      expect(tableExists(db, 'pmo_ticket_labels')).to.be.false
      expect(tableExists(db, 'pmo_roadmaps')).to.be.false
      expect(tableExists(db, 'pmo_roadmap_projects')).to.be.false

      // Surviving tables (still in schema)
      expect(tableExists(db, 'pmo_labels')).to.be.true
      expect(tableExists(db, 'pmo_label_groups')).to.be.true

      db.close()
    })

    it('catch-up is a no-op on an already-current DB', () => {
      const db = openDb()
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      // Capture full schema state
      const tablesBefore = getTableNames(db)
      const columnsBefore: Record<string, string[]> = {}
      for (const t of tablesBefore) {
        columnsBefore[t] = getTableColumns(db, t)
      }
      const indexesBefore = getIndexNames(db)

      // Run catch-up again by itself (simulating re-run)
      // The migration is already recorded so it won't run, but verify state is unchanged
      runDrizzleMigrations(db, ALL_MIGRATIONS)

      const tablesAfter = getTableNames(db)
      const columnsAfter: Record<string, string[]> = {}
      for (const t of tablesAfter) {
        columnsAfter[t] = getTableColumns(db, t)
      }
      const indexesAfter = getIndexNames(db)

      expect(tablesAfter).to.deep.equal(tablesBefore)
      expect(columnsAfter).to.deep.equal(columnsBefore)
      expect(indexesAfter).to.deep.equal(indexesBefore)

      db.close()
    })

    it('catch-up includes 0016 in migration registry', () => {
      expect(ALL_MIGRATIONS.some(m => m.id === '0016' && m.name === 'schema_catchup')).to.be.true
    })
  })
})
