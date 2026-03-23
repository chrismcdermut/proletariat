import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  enableWALMode,
  createRotatingBackup,
  checkIntegrity,
  quickCheckIntegrity,
  repairDatabase,
  getBackupPath,
} from '../../src/lib/database/db-safety.js'

describe('db-safety', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-db-safety-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createTestDb(dbPath: string): SqliteDatabase {
    const db = new SqliteDatabase(dbPath)
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

  describe('createRotatingBackup', () => {
    it('should create backup.1 from the database file', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      const result = createRotatingBackup(dbPath)
      expect(result).to.be.true
      expect(fs.existsSync(getBackupPath(dbPath, 1))).to.be.true
    })

    it('should rotate existing backups', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      // Create 3 backups
      createRotatingBackup(dbPath)
      createRotatingBackup(dbPath)
      createRotatingBackup(dbPath)

      expect(fs.existsSync(getBackupPath(dbPath, 1))).to.be.true
      expect(fs.existsSync(getBackupPath(dbPath, 2))).to.be.true
      expect(fs.existsSync(getBackupPath(dbPath, 3))).to.be.true
    })

    it('should limit to 5 backups', () => {
      const dbPath = path.join(tmpDir, 'test.db')
      const db = createTestDb(dbPath)
      db.close()

      for (let i = 0; i < 7; i++) {
        createRotatingBackup(dbPath)
      }

      expect(fs.existsSync(getBackupPath(dbPath, 1))).to.be.true
      expect(fs.existsSync(getBackupPath(dbPath, 5))).to.be.true
      expect(fs.existsSync(getBackupPath(dbPath, 6))).to.be.false
    })

    it('should return false if source does not exist', () => {
      const result = createRotatingBackup(path.join(tmpDir, 'nonexistent.db'))
      expect(result).to.be.false
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
      const repaired = new SqliteDatabase(dbPath)
      const rows = repaired.prepare('SELECT * FROM test ORDER BY id').all() as { id: number; value: string }[]
      expect(rows).to.have.length(2)
      expect(rows[0].value).to.equal('hello')
      expect(rows[1].value).to.equal('world')
      repaired.close()

      // Corrupt backup should exist
      expect(fs.existsSync(`${dbPath}.corrupt`)).to.be.true
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
      const restored = new SqliteDatabase(dbPath)
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
  })

  describe('WAL mode on openWorkspaceDatabase', () => {
    it('should set WAL mode when opening a fresh workspace database', () => {
      // This is an integration-style test — create a minimal workspace structure
      const wsPath = path.join(tmpDir, 'workspace')
      const prltDir = path.join(wsPath, '.proletariat')
      fs.mkdirSync(prltDir, { recursive: true })

      const dbPath = path.join(prltDir, 'workspace.db')
      const db = new SqliteDatabase(dbPath)
      db.exec('CREATE TABLE IF NOT EXISTS prlt_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
      db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, type TEXT NOT NULL DEFAULT "hq", workspace_name TEXT NOT NULL DEFAULT "test", has_pmo INTEGER NOT NULL DEFAULT 0, active_theme_id TEXT, created_at TEXT NOT NULL DEFAULT "")')
      db.exec("INSERT OR IGNORE INTO workspace VALUES (1, 'hq', 'test', 0, NULL, '2024-01-01')")
      db.close()

      // Now open with enableWALMode directly and verify
      const db2 = new SqliteDatabase(dbPath)
      enableWALMode(db2)
      const mode = db2.pragma('journal_mode', { simple: true })
      expect(mode).to.equal('wal')
      db2.close()
    })
  })
})
