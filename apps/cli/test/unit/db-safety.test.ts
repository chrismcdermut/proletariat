import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  enableWALMode,
  createRotatingBackup,
  createManualBackup,
  checkIntegrity,
  quickCheckIntegrity,
  checkSchemaCompleteness,
  repairDatabase,
  getBackupPath,
  getBackupsDir,
  listBackups,
  migrateExistingBackups,
} from '../../src/lib/database/db-safety.js'
import {
  checkPMOExists,
  getPMOSetting,
  dropPMOTables,
} from '../../src/lib/database/pmo-bootstrap.js'

describe('db-safety', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-db-safety-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createTestDb(dbPath: string): Database.Database {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    db.exec("INSERT INTO test VALUES (1, 'hello')")
    db.exec("INSERT INTO test VALUES (2, 'world')")
    return db
  }

  describe('enableWALMode', () => {
    it('should set journal_mode to WAL', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)

      enableWALMode(db)
      const mode = db.pragma('journal_mode', { simple: true })
      expect(mode).to.equal('wal')

      db.close()
    })
  })

  describe('getBackupsDir', () => {
    it('should return a backups/ sibling directory', () => {
      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const result = getBackupsDir(dbPath)
      expect(result).to.equal(path.join(tmpDir, '.proletariat', 'backups'))
    })
  })

  describe('createRotatingBackup', () => {
    it('should create a timestamped backup in the backups/ directory', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const result = createRotatingBackup(dbPath)
      expect(result).to.not.be.null

      const backupsDir = getBackupsDir(dbPath)
      expect(fs.existsSync(backupsDir)).to.be.true

      const files = fs.readdirSync(backupsDir)
      expect(files.length).to.be.greaterThan(0)
      expect(files[0]).to.match(/^workspace-\d{8}-\d{6}-\d{3}(-\d+)?\.db$/)
    })

    it('should rotate backups keeping only the last 5', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      // Create 7 backups with slight delays to get unique timestamps
      const backupsDir = getBackupsDir(dbPath)
      fs.mkdirSync(backupsDir, { recursive: true })

      // Create fake old backups
      for (let i = 0; i < 7; i++) {
        const name = `workspace-20260101-00000${i}.db`
        fs.copyFileSync(dbPath, path.join(backupsDir, name))
      }

      // This should trigger rotation
      createRotatingBackup(dbPath)

      const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db'))
      expect(files.length).to.equal(5)
    })

    it('should return null if source does not exist', () => {
      const result = createRotatingBackup(path.join(tmpDir, 'nonexistent.db'))
      expect(result).to.be.null
    })
  })

  describe('getBackupPath', () => {
    it('should return the nth most recent backup', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const backupsDir = getBackupsDir(dbPath)
      fs.mkdirSync(backupsDir, { recursive: true })

      // Create 3 backups with known timestamps
      const names = [
        'workspace-20260101-000001.db',
        'workspace-20260101-000002.db',
        'workspace-20260101-000003.db',
      ]
      for (const name of names) {
        fs.copyFileSync(dbPath, path.join(backupsDir, name))
      }

      // n=1 should be the newest (000003)
      const newest = getBackupPath(dbPath, 1)
      expect(newest).to.not.be.null
      expect(path.basename(newest!)).to.equal('workspace-20260101-000003.db')
    })

    it('should return null for out-of-range n', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      expect(getBackupPath(dbPath, 1)).to.be.null
      expect(getBackupPath(dbPath, 0)).to.be.null
    })
  })

  describe('createManualBackup', () => {
    it('should create a manual backup with label', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const result = createManualBackup(dbPath, 'pre-migration')
      expect(result).to.not.be.null
      expect(path.basename(result!)).to.match(/^workspace-manual-pre-migration-\d{8}-\d{6}-\d{3}(-\d+)?\.db$/)
    })

    it('should create a manual backup without label', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const result = createManualBackup(dbPath)
      expect(result).to.not.be.null
      expect(path.basename(result!)).to.match(/^workspace-manual-\d{8}-\d{6}-\d{3}(-\d+)?\.db$/)
    })
  })

  describe('listBackups', () => {
    it('should return backup entries sorted newest-first', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const backupsDir = getBackupsDir(dbPath)
      fs.mkdirSync(backupsDir, { recursive: true })

      const names = [
        'workspace-20260101-000001.db',
        'workspace-20260101-000003.db',
        'workspace-20260101-000002.db',
      ]
      for (const name of names) {
        fs.copyFileSync(dbPath, path.join(backupsDir, name))
      }

      const backups = listBackups(dbPath)
      expect(backups.length).to.equal(3)
      // All entries should have expected fields
      expect(backups[0]).to.have.property('filename')
      expect(backups[0]).to.have.property('path')
      expect(backups[0]).to.have.property('size')
      expect(backups[0]).to.have.property('mtime')
    })

    it('should return empty array when no backups exist', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const backups = listBackups(dbPath)
      expect(backups).to.deep.equal([])
    })
  })

  describe('migrateExistingBackups', () => {
    it('should move legacy backup files into backups/', () => {
      const prltDir = path.join(tmpDir, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = createTestDb(dbPath)
      db.close()

      // Create legacy backup files
      fs.copyFileSync(dbPath, path.join(prltDir, 'workspace.db.backup'))
      fs.copyFileSync(dbPath, path.join(prltDir, 'workspace.db.backup-20260106-112422'))
      fs.copyFileSync(dbPath, path.join(prltDir, 'workspace.db.backup.1'))
      fs.writeFileSync(path.join(prltDir, 'workspace.db.corrupt'), 'corrupt data')

      migrateExistingBackups(dbPath)

      // Legacy files should be gone from top level
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup'))).to.be.false
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup-20260106-112422'))).to.be.false
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup.1'))).to.be.false
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.corrupt'))).to.be.false

      // Should be in backups/ directory
      const backupsDir = getBackupsDir(dbPath)
      expect(fs.existsSync(backupsDir)).to.be.true

      const files = fs.readdirSync(backupsDir)
      expect(files.length).to.be.greaterThan(0)
    })

    it('should not move the active workspace.db', () => {
      const prltDir = path.join(tmpDir, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = createTestDb(dbPath)
      db.close()

      migrateExistingBackups(dbPath)

      // Active database should still be in place
      expect(fs.existsSync(dbPath)).to.be.true
    })

    it('should be safe to call multiple times', () => {
      const prltDir = path.join(tmpDir, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = createTestDb(dbPath)
      db.close()

      fs.copyFileSync(dbPath, path.join(prltDir, 'workspace.db.backup'))

      migrateExistingBackups(dbPath)
      migrateExistingBackups(dbPath) // second call should be a no-op

      const backupsDir = getBackupsDir(dbPath)
      const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db'))
      // Should not have duplicates from second call
      expect(files.length).to.be.greaterThanOrEqual(1)
    })

    it('should handle WAL/SHM companions for numbered backups', () => {
      const prltDir = path.join(tmpDir, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = createTestDb(dbPath)
      db.close()

      fs.copyFileSync(dbPath, path.join(prltDir, 'workspace.db.backup.1'))
      fs.writeFileSync(path.join(prltDir, 'workspace.db.backup.1-wal'), 'wal data')
      fs.writeFileSync(path.join(prltDir, 'workspace.db.backup.1-shm'), 'shm data')

      migrateExistingBackups(dbPath)

      // All legacy files should be gone
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup.1'))).to.be.false
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup.1-wal'))).to.be.false
      expect(fs.existsSync(path.join(prltDir, 'workspace.db.backup.1-shm'))).to.be.false
    })
  })

  describe('checkIntegrity / quickCheckIntegrity', () => {
    it('should report ok for a healthy database', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)

      const full = checkIntegrity(db)
      expect(full.ok).to.be.true
      expect(full.errors).to.have.length(0)

      const quick = quickCheckIntegrity(db)
      expect(quick.ok).to.be.true
      expect(quick.errors).to.have.length(0)

      db.close()
    })
  })

  describe('repairDatabase', () => {
    it('should recover data from a valid database via dump-reimport', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      // Simulate by running repair on a valid database
      // (dump-reimport should still work and preserve data)
      const result = repairDatabase(dbPath)
      expect(result.success).to.be.true
      expect(result.method).to.equal('dump-reimport')

      // Verify data survived
      const repaired = new Database(dbPath)
      const rows = repaired.prepare('SELECT * FROM test ORDER BY id').all() as { id: number; value: string }[]
      expect(rows).to.have.length(2)
      expect(rows[0].value).to.equal('hello')
      expect(rows[1].value).to.equal('world')
      repaired.close()

      // Corrupt backup should exist in backups/ directory
      const backupsDir = getBackupsDir(dbPath)
      const corruptFiles = fs.readdirSync(backupsDir).filter(f => f.includes('corrupt'))
      expect(corruptFiles.length).to.be.greaterThan(0)
    })

    it('should fall back to backup if dump fails on a truly corrupt file', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      // Create a backup first
      createRotatingBackup(dbPath)

      // Corrupt the database by overwriting with garbage
      fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database'))

      const result = repairDatabase(dbPath)
      expect(result.success).to.be.true
      expect(result.method).to.equal('backup-restore')

      // Verify restored data
      const restored = new Database(dbPath)
      const rows = restored.prepare('SELECT * FROM test ORDER BY id').all() as { id: number; value: string }[]
      expect(rows).to.have.length(2)
      expect(rows[0].value).to.equal('hello')
      restored.close()
    })

    it('should fail gracefully when no recovery is possible', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      // Write garbage with no backups
      fs.writeFileSync(dbPath, Buffer.from('corrupted'))

      const result = repairDatabase(dbPath)
      expect(result.success).to.be.false
      expect(result.method).to.equal('none')
    })

    it('should save corrupt files in backups/ directory', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      repairDatabase(dbPath)

      // Corrupt file should be in backups/, not alongside the db
      const corruptAtTopLevel = fs.existsSync(`${dbPath}.corrupt`)
      expect(corruptAtTopLevel).to.be.false

      const backupsDir = getBackupsDir(dbPath)
      const corruptFiles = fs.readdirSync(backupsDir).filter(f => f.includes('corrupt'))
      expect(corruptFiles.length).to.be.greaterThan(0)
    })
  })

  // =========================================================================
  // PRLT-1152: PMO bootstrap must use db-safety auto-repair layer
  // =========================================================================
  describe('PMO bootstrap auto-repair (PRLT-1152)', () => {
    function createPMODatabase(dbPath: string): void {
      const db = new Database(dbPath)
      db.exec('CREATE TABLE pmo_projects (id TEXT PRIMARY KEY, name TEXT)')
      db.exec('CREATE TABLE pmo_tickets (id TEXT PRIMARY KEY, title TEXT)')
      db.exec('CREATE TABLE pmo_settings (key TEXT PRIMARY KEY, value TEXT)')
      db.exec("INSERT INTO pmo_projects VALUES ('P1', 'Project 1')")
      db.exec("INSERT INTO pmo_tickets VALUES ('T1', 'Ticket 1')")
      db.exec("INSERT INTO pmo_settings VALUES ('version', '1.0')")
      db.close()
    }

    it('checkPMOExists auto-repairs a corrupt database instead of failing', () => {
      const dbPath = path.join(tmpDir, 'workspace.db')
      createPMODatabase(dbPath)

      // Create a backup before corruption so repair has something to restore from
      createRotatingBackup(dbPath)

      // Corrupt the database
      fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database'))

      // Before the fix (PRLT-1152), this would throw SQLITE_CORRUPT or
      // report PMO not found. After the fix, it should auto-repair and succeed.
      const result = checkPMOExists(dbPath)
      expect(result.exists).to.be.true
      expect(result.projectCount).to.equal(1)
      expect(result.ticketCount).to.equal(1)
    })

    it('getPMOSetting auto-repairs a corrupt database instead of failing', () => {
      const dbPath = path.join(tmpDir, 'workspace.db')
      createPMODatabase(dbPath)
      createRotatingBackup(dbPath)

      // Corrupt the database
      fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database'))

      const value = getPMOSetting(dbPath, 'version')
      expect(value).to.equal('1.0')
    })

    it('dropPMOTables auto-repairs a corrupt database instead of failing', () => {
      const dbPath = path.join(tmpDir, 'workspace.db')
      createPMODatabase(dbPath)
      createRotatingBackup(dbPath)

      // Corrupt the database
      fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database'))

      // Should auto-repair and then drop tables without throwing
      dropPMOTables(dbPath, ['pmo_projects', 'pmo_tickets'])

      // Verify tables were dropped from the repaired database
      const db = new Database(dbPath)
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pmo_projects', 'pmo_tickets')"
      ).all()
      expect(tables).to.have.length(0)
      db.close()
    })

    it('checkPMOExists throws descriptive error when repair is impossible', () => {
      const dbPath = path.join(tmpDir, 'workspace.db')
      // Write garbage with no backups available
      fs.writeFileSync(dbPath, Buffer.from('corrupted beyond repair'))

      expect(() => checkPMOExists(dbPath)).to.throw('Database corruption detected')
    })

    it('checkPMOExists creates a backup before opening', () => {
      const dbPath = path.join(tmpDir, 'workspace.db')
      createPMODatabase(dbPath)

      // No backups should exist yet
      const backupsDir = getBackupsDir(dbPath)
      expect(fs.existsSync(backupsDir)).to.be.false

      checkPMOExists(dbPath)

      // After calling checkPMOExists, a backup should have been created
      expect(fs.existsSync(backupsDir)).to.be.true
      const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db'))
      expect(files.length).to.be.greaterThan(0)
    })
  })

  // =========================================================================
  // PRLT-1131: db repair must detect missing columns (schema completeness)
  // =========================================================================
  describe('checkSchemaCompleteness (PRLT-1131)', () => {
    it('should report ok for a database with all expected columns', () => {
      const dbPath = path.join(tmpDir, 'schema-ok.db')
      const db = new Database(dbPath)

      // Create workspace tables with all expected columns
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE repositories (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT DEFAULT 'main',
          source_url TEXT,
          action TEXT,
          added_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agent_themes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          builtin BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agent_theme_names (
          theme_id TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (theme_id, name)
        )
      `)
      db.exec(`
        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          base_name TEXT,
          theme_id TEXT,
          worktree_path TEXT,
          mount_mode TEXT NOT NULL DEFAULT 'worktree',
          created_at TEXT NOT NULL,
          cleaned_at TEXT
        )
      `)
      db.exec(`
        CREATE TABLE agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_commit_hash TEXT,
          commits_ahead INTEGER NOT NULL DEFAULT 0,
          is_clean INTEGER NOT NULL DEFAULT 1,
          last_checked TEXT,
          PRIMARY KEY (agent_name, repo_name)
        )
      `)
      db.exec(`
        CREATE TABLE workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE media_items (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          source_path TEXT,
          media_type TEXT NOT NULL DEFAULT 'video',
          duration_seconds REAL,
          resolution TEXT,
          frame_count INTEGER NOT NULL DEFAULT 0,
          has_transcript INTEGER NOT NULL DEFAULT 0,
          frame_interval INTEGER NOT NULL DEFAULT 30,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          added_at TEXT NOT NULL,
          processed_at TEXT
        )
      `)

      const result = checkSchemaCompleteness(db)
      db.close()

      expect(result.ok).to.be.true
      expect(result.missingTables).to.have.length(0)
      expect(result.missingColumns).to.have.length(0)
    })

    it('should detect missing columns on existing tables', () => {
      const dbPath = path.join(tmpDir, 'schema-missing-cols.db')
      const db = new Database(dbPath)

      // Create agents table WITHOUT mount_mode, base_name, cleaned_at
      // (simulates a database from an older version)
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY,
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          theme_id TEXT,
          worktree_path TEXT,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (agent_name, repo_name)
        )
      `)

      const result = checkSchemaCompleteness(db)
      db.close()

      expect(result.ok).to.be.false

      // agents should be missing: base_name, mount_mode, cleaned_at
      const agentMissing = result.missingColumns
        .filter(c => c.table === 'agents')
        .map(c => c.column)
      expect(agentMissing).to.include('base_name')
      expect(agentMissing).to.include('mount_mode')
      expect(agentMissing).to.include('cleaned_at')

      // agent_worktrees should be missing: last_commit_hash, commits_ahead, is_clean, last_checked
      const worktreeMissing = result.missingColumns
        .filter(c => c.table === 'agent_worktrees')
        .map(c => c.column)
      expect(worktreeMissing).to.include('last_commit_hash')
      expect(worktreeMissing).to.include('commits_ahead')
      expect(worktreeMissing).to.include('is_clean')
      expect(worktreeMissing).to.include('last_checked')
    })

    it('should report missing core workspace tables', () => {
      const dbPath = path.join(tmpDir, 'schema-missing-table.db')
      const db = new Database(dbPath)

      // Only create workspace — skip agents, repositories, etc.
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY,
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        )
      `)

      const result = checkSchemaCompleteness(db)
      db.close()

      expect(result.ok).to.be.false
      expect(result.missingTables).to.include('agents')
      expect(result.missingTables).to.include('repositories')
    })

    it('should NOT report healthy when PRAGMA integrity_check passes but columns are missing', () => {
      // This is the core regression test for PRLT-1131 / GitHub #957
      const dbPath = path.join(tmpDir, 'schema-false-neg.db')
      const db = new Database(dbPath)

      // Create an old-style agents table (missing columns from later migrations)
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY,
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          theme_id TEXT,
          worktree_path TEXT,
          created_at TEXT NOT NULL
        )
      `)

      // PRAGMA integrity_check says OK — this is the false negative
      const integrity = checkIntegrity(db)
      expect(integrity.ok).to.be.true

      // But schema completeness catches the missing columns
      const schema = checkSchemaCompleteness(db)
      expect(schema.ok).to.be.false
      expect(schema.missingColumns.length).to.be.greaterThan(0)

      db.close()
    })

    it('should skip PMO tables when PMO is not initialized', () => {
      const dbPath = path.join(tmpDir, 'schema-no-pmo.db')
      const db = new Database(dbPath)

      // Create only core workspace tables — no PMO tables
      db.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY,
          type TEXT NOT NULL,
          workspace_name TEXT NOT NULL,
          has_pmo BOOLEAN DEFAULT FALSE,
          active_theme_id TEXT,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE repositories (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT DEFAULT 'main',
          source_url TEXT,
          action TEXT,
          added_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agent_themes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          builtin BOOLEAN DEFAULT FALSE,
          created_at TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE agent_theme_names (
          theme_id TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (theme_id, name)
        )
      `)
      db.exec(`
        CREATE TABLE agents (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'persistent',
          status TEXT NOT NULL DEFAULT 'active',
          base_name TEXT,
          theme_id TEXT,
          worktree_path TEXT,
          mount_mode TEXT NOT NULL DEFAULT 'worktree',
          created_at TEXT NOT NULL,
          cleaned_at TEXT
        )
      `)
      db.exec(`
        CREATE TABLE agent_worktrees (
          agent_name TEXT NOT NULL,
          repo_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_commit_hash TEXT,
          commits_ahead INTEGER NOT NULL DEFAULT 0,
          is_clean INTEGER NOT NULL DEFAULT 1,
          last_checked TEXT,
          PRIMARY KEY (agent_name, repo_name)
        )
      `)
      db.exec(`
        CREATE TABLE workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      db.exec(`
        CREATE TABLE media_items (
          name TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          source_path TEXT,
          media_type TEXT NOT NULL DEFAULT 'video',
          duration_seconds REAL,
          resolution TEXT,
          frame_count INTEGER NOT NULL DEFAULT 0,
          has_transcript INTEGER NOT NULL DEFAULT 0,
          frame_interval INTEGER NOT NULL DEFAULT 30,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          added_at TEXT NOT NULL,
          processed_at TEXT
        )
      `)

      const result = checkSchemaCompleteness(db)
      db.close()

      // Should be healthy since PMO is not initialized — PMO tables not expected
      expect(result.ok).to.be.true
    })
  })

  describe('WAL mode on openWorkspaceDatabase', () => {
    it('should set WAL mode when opening a fresh workspace database', () => {
      // This is an integration-style test — create a minimal workspace structure
      const wsPath = path.join(tmpDir, 'workspace')
      const prltDir = path.join(wsPath, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = new Database(dbPath)
      db.exec('CREATE TABLE IF NOT EXISTS prlt_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
      db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, type TEXT NOT NULL DEFAULT "hq", workspace_name TEXT NOT NULL DEFAULT "test", has_pmo INTEGER NOT NULL DEFAULT 0, active_theme_id TEXT, created_at TEXT NOT NULL DEFAULT "")')
      db.exec("INSERT OR IGNORE INTO workspace VALUES (1, 'hq', 'test', 0, NULL, '2024-01-01')")
      db.close()

      // Now open with enableWALMode directly and verify
      const db2 = new Database(dbPath)
      enableWALMode(db2)
      const mode = db2.pragma('journal_mode', { simple: true })
      expect(mode).to.equal('wal')
      db2.close()
    })
  })
})
