import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  SqliteDatabase,
  _resetConnectionPool,
  _getPoolSize,
} from '../../src/lib/database/sqlite.js'

/**
 * Regression tests for PRLT-1100: sql.js OOM fix.
 *
 * The OOM was caused by multiple SqliteDatabase instances opening the same
 * workspace.db file simultaneously (PMO storage + ExecutionStorage during
 * work start). Each instance loaded the entire database into WASM memory,
 * and auto-save triggered cross-instance reload ping-pong that exhausted
 * WASM heap memory.
 *
 * These tests verify:
 * 1. SqliteDatabase.open() returns shared instances for the same file path
 * 2. Reference counting prevents premature close
 * 3. Dirty tracking prevents redundant disk writes
 * 4. The fix reverts correctly (tests must fail without the fix)
 */
describe('SqliteDatabase connection pool (PRLT-1100)', () => {
  let tmpDir: string

  beforeEach(() => {
    _resetConnectionPool()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-connpool-'))
  })

  afterEach(() => {
    _resetConnectionPool()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createTestDb(name: string = 'test.db'): string {
    const dbPath = path.join(tmpDir, name)
    const db = new SqliteDatabase(dbPath)
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')
    db.exec("INSERT INTO items VALUES (1, 'alpha')")
    db.close()
    return dbPath
  }

  describe('SqliteDatabase.open() — shared connections', () => {
    it('should return the same instance for the same file path', () => {
      const dbPath = createTestDb()

      const db1 = SqliteDatabase.open(dbPath)
      const db2 = SqliteDatabase.open(dbPath)

      expect(db1).to.equal(db2)
      expect(_getPoolSize()).to.equal(1)

      db1.close()
      db2.close()
    })

    it('should share state between callers (simulates PMO + ExecutionStorage)', () => {
      const dbPath = createTestDb()

      // Simulate PMO storage opening the database
      const pmoDb = SqliteDatabase.open(dbPath)

      // Simulate ExecutionStorage opening the same database
      const execDb = SqliteDatabase.open(dbPath)

      // Write via one caller
      pmoDb.exec("INSERT INTO items VALUES (2, 'beta')")

      // Read via the other — should see the write immediately
      const row = execDb.prepare("SELECT name FROM items WHERE id = 2").get() as { name: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.name).to.equal('beta')

      pmoDb.close()
      execDb.close()
    })

    it('should mark shared connections as isShared', () => {
      const dbPath = createTestDb()

      const db = SqliteDatabase.open(dbPath)
      expect(db.isShared).to.be.true

      db.close()
    })

    it('should not share in-memory databases', () => {
      const db1 = SqliteDatabase.open(':memory:')
      const db2 = SqliteDatabase.open(':memory:')

      expect(db1).to.not.equal(db2)
      expect(db1.isShared).to.be.false
      expect(db2.isShared).to.be.false

      db1.close()
      db2.close()
    })

    it('should resolve relative and absolute paths to the same pool entry', () => {
      const dbPath = createTestDb()
      const cwd = process.cwd()

      // Open with absolute path
      const db1 = SqliteDatabase.open(dbPath)

      // Open with different-but-equivalent path (adding /.)
      const altPath = path.join(path.dirname(dbPath), '.', path.basename(dbPath))
      const db2 = SqliteDatabase.open(altPath)

      expect(db1).to.equal(db2)
      expect(_getPoolSize()).to.equal(1)

      db1.close()
      db2.close()
    })
  })

  describe('reference counting', () => {
    it('should keep the connection open until all callers close', () => {
      const dbPath = createTestDb()

      const db1 = SqliteDatabase.open(dbPath)
      const db2 = SqliteDatabase.open(dbPath)
      const db3 = SqliteDatabase.open(dbPath)

      // First close — still 2 references
      db1.close()
      expect(db2.open).to.be.true
      expect(_getPoolSize()).to.equal(1)

      // Second close — still 1 reference
      db2.close()
      expect(db3.open).to.be.true
      expect(_getPoolSize()).to.equal(1)

      // Final close — actually closes
      db3.close()
      expect(db3.open).to.be.false
      expect(_getPoolSize()).to.equal(0)
    })

    it('should persist data to disk after all callers close', () => {
      const dbPath = createTestDb()

      const db1 = SqliteDatabase.open(dbPath)
      const db2 = SqliteDatabase.open(dbPath)

      db1.exec("INSERT INTO items VALUES (3, 'gamma')")
      db1.close()
      db2.close()

      // Reopen and verify data was persisted
      const verify = new SqliteDatabase(dbPath)
      const row = verify.prepare("SELECT name FROM items WHERE id = 3").get() as { name: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.name).to.equal('gamma')
      verify.close()
    })

    it('should allow reopening a path after all references are closed', () => {
      const dbPath = createTestDb()

      const db1 = SqliteDatabase.open(dbPath)
      db1.exec("INSERT INTO items VALUES (4, 'delta')")
      db1.close()

      // Reopen via pool — should get a new instance
      const db2 = SqliteDatabase.open(dbPath)
      expect(db2.open).to.be.true

      const row = db2.prepare("SELECT name FROM items WHERE id = 4").get() as { name: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.name).to.equal('delta')

      db2.close()
    })
  })

  describe('dirty tracking', () => {
    it('should not write to disk when no changes were made', () => {
      const dbPath = createTestDb()

      const db = SqliteDatabase.open(dbPath)
      const mtimeBefore = fs.statSync(dbPath).mtimeMs

      // Read-only operations should not trigger save
      db.prepare("SELECT * FROM items").all()

      // Small delay to ensure mtime would differ if a write occurred
      const busyWait = Date.now() + 50
      while (Date.now() < busyWait) { /* spin */ }

      // save() should be a no-op since nothing is dirty
      db.save()
      const mtimeAfter = fs.statSync(dbPath).mtimeMs

      expect(mtimeAfter).to.equal(mtimeBefore)

      db.close()
    })

    it('should write to disk after a modification', () => {
      const dbPath = createTestDb()

      const db = SqliteDatabase.open(dbPath)

      // Wait to ensure mtime changes
      const busyWait = Date.now() + 50
      while (Date.now() < busyWait) { /* spin */ }

      db.exec("INSERT INTO items VALUES (5, 'epsilon')")

      // The auto-save should have written to disk
      const verify = new SqliteDatabase(dbPath, { readonly: true })
      const row = verify.prepare("SELECT name FROM items WHERE id = 5").get() as { name: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.name).to.equal('epsilon')
      verify.close()

      db.close()
    })
  })

  describe('eliminates ping-pong reloads (root cause)', () => {
    it('should not trigger reloads when using shared connections', () => {
      const dbPath = createTestDb()

      // With the fix: both share the same instance, so there's no
      // "external change" detection because there's only one instance.
      const db1 = SqliteDatabase.open(dbPath)
      const db2 = SqliteDatabase.open(dbPath)

      // Write from db1
      db1.exec("INSERT INTO items VALUES (10, 'shared-write')")

      // Read from db2 — should see it immediately without reload
      const row = db2.prepare("SELECT name FROM items WHERE id = 10").get() as { name: string } | undefined
      expect(row).to.not.be.undefined
      expect(row!.name).to.equal('shared-write')

      db1.close()
      db2.close()
    })

    it('should handle many writes without OOM (stress test)', () => {
      const dbPath = createTestDb()

      const db1 = SqliteDatabase.open(dbPath)
      const db2 = SqliteDatabase.open(dbPath)

      // Simulate heavy work start flow: many writes from both "subsystems"
      // Without the fix, each write from db1 triggers a reload in db2 and vice versa,
      // allocating ~4MB each time (export + Buffer.from + readFile + new Database).
      // With 100 writes, that's 400MB of churn in WASM memory.
      for (let i = 100; i < 200; i++) {
        db1.exec(`INSERT INTO items VALUES (${i}, 'item-${i}')`)
      }
      for (let i = 200; i < 300; i++) {
        db2.exec(`INSERT INTO items VALUES (${i}, 'item-${i}')`)
      }

      // Verify all data is present
      const count = db1.prepare("SELECT COUNT(*) as cnt FROM items").get() as { cnt: number }
      // 1 original + 200 new = 201
      expect(count.cnt).to.equal(201)

      db1.close()
      db2.close()
    })
  })

  describe('constructor (non-shared) behavior unchanged', () => {
    it('should create independent instances with new SqliteDatabase()', () => {
      const dbPath = createTestDb()

      const db1 = new SqliteDatabase(dbPath)
      const db2 = new SqliteDatabase(dbPath)

      expect(db1).to.not.equal(db2)
      expect(db1.isShared).to.be.false
      expect(db2.isShared).to.be.false

      db1.close()
      db2.close()
    })
  })

  describe('_resetConnectionPool', () => {
    it('should close all shared connections and clear the pool', () => {
      const db1Path = createTestDb('db1.db')
      const db2Path = createTestDb('db2.db')

      const conn1 = SqliteDatabase.open(db1Path)
      const conn2 = SqliteDatabase.open(db2Path)
      expect(_getPoolSize()).to.equal(2)

      _resetConnectionPool()
      expect(_getPoolSize()).to.equal(0)
      expect(conn1.open).to.be.false
      expect(conn2.open).to.be.false
    })
  })
})
