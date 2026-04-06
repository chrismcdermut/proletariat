/**
 * PRLT-1264: Verify WAL mode is configured on all database access paths.
 *
 * These tests ensure that every function that opens a SQLite database
 * correctly enables WAL mode for concurrent read/write safety.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { openDriver } from '../../src/lib/database/driver.js'
import { openDrizzleDatabase, closeDrizzleDatabase } from '../../src/lib/database/drizzle.js'
import { configureConnection } from '../../src/lib/database/db-safety.js'

describe('WAL concurrent access (PRLT-1264)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-wal-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createMinimalDb(dbPath: string): void {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    db.close()
  }

  describe('openDriver', () => {
    it('should enable WAL mode', () => {
      const dbPath = path.join(tmpDir, 'driver.db')
      createMinimalDb(dbPath)

      const driver = openDriver(dbPath)
      const mode = driver.pragma('journal_mode', { simple: true })
      expect(mode).to.equal('wal')
      driver.close()
    })

    it('should set synchronous = NORMAL', () => {
      const dbPath = path.join(tmpDir, 'driver-sync.db')
      createMinimalDb(dbPath)

      const driver = openDriver(dbPath)
      const sync = driver.pragma('synchronous', { simple: true })
      expect(sync).to.equal(1)
      driver.close()
    })

    it('should set busy_timeout', () => {
      const dbPath = path.join(tmpDir, 'driver-timeout.db')
      createMinimalDb(dbPath)

      const driver = openDriver(dbPath)
      const timeout = driver.pragma('busy_timeout', { simple: true })
      expect(timeout).to.equal(5000)
      driver.close()
    })

    it('should respect custom busy_timeout', () => {
      const dbPath = path.join(tmpDir, 'driver-custom-timeout.db')
      createMinimalDb(dbPath)

      const driver = openDriver(dbPath, { busyTimeout: 3000 })
      const timeout = driver.pragma('busy_timeout', { simple: true })
      expect(timeout).to.equal(3000)
      driver.close()
    })

    it('should skip WAL mode for readonly connections', () => {
      const dbPath = path.join(tmpDir, 'driver-readonly.db')
      createMinimalDb(dbPath)

      const driver = openDriver(dbPath, { readonly: true })
      // readonly connections can't set journal_mode; verify no error
      driver.close()
    })
  })

  describe('openDrizzleDatabase', () => {
    it('should enable WAL mode', () => {
      const dbPath = path.join(tmpDir, 'drizzle.db')
      createMinimalDb(dbPath)

      const { sqliteDb } = openDrizzleDatabase(dbPath)
      const mode = sqliteDb.pragma('journal_mode', { simple: true })
      expect(mode).to.equal('wal')
      closeDrizzleDatabase(sqliteDb)
    })

    it('should set synchronous = NORMAL', () => {
      const dbPath = path.join(tmpDir, 'drizzle-sync.db')
      createMinimalDb(dbPath)

      const { sqliteDb } = openDrizzleDatabase(dbPath)
      const sync = sqliteDb.pragma('synchronous', { simple: true })
      expect(sync).to.equal(1)
      closeDrizzleDatabase(sqliteDb)
    })

    it('should set busy_timeout', () => {
      const dbPath = path.join(tmpDir, 'drizzle-timeout.db')
      createMinimalDb(dbPath)

      const { sqliteDb } = openDrizzleDatabase(dbPath)
      const timeout = sqliteDb.pragma('busy_timeout', { simple: true })
      expect(timeout).to.equal(5000)
      closeDrizzleDatabase(sqliteDb)
    })
  })

  describe('concurrent access safety', () => {
    it('should allow concurrent readers with WAL mode', () => {
      const dbPath = path.join(tmpDir, 'concurrent.db')
      createMinimalDb(dbPath)

      // Open two connections — both should be able to read concurrently
      const db1 = new Database(dbPath)
      configureConnection(db1)
      const db2 = new Database(dbPath)
      configureConnection(db2)

      // Insert via db1
      db1.exec("INSERT INTO test VALUES (1, 'from-db1')")

      // Read from both — should work without SQLITE_BUSY
      const rows1 = db1.prepare('SELECT * FROM test').all()
      const rows2 = db2.prepare('SELECT * FROM test').all()

      expect(rows1).to.have.length(1)
      expect(rows2).to.have.length(1)

      db1.close()
      db2.close()
    })

    it('should handle write contention gracefully with busy_timeout', () => {
      const dbPath = path.join(tmpDir, 'contention.db')
      createMinimalDb(dbPath)

      const db1 = new Database(dbPath)
      configureConnection(db1)
      const db2 = new Database(dbPath)
      configureConnection(db2)

      // Begin a write transaction on db1
      db1.exec('BEGIN IMMEDIATE')
      db1.exec("INSERT INTO test VALUES (1, 'from-db1')")

      // db2 read should still work (WAL allows concurrent reads with writes)
      const rows = db2.prepare('SELECT * FROM test').all()
      expect(rows).to.have.length(0) // db1's write is not committed yet

      db1.exec('COMMIT')

      // After commit, db2 should see the new data
      const rowsAfter = db2.prepare('SELECT * FROM test').all()
      expect(rowsAfter).to.have.length(1)

      db1.close()
      db2.close()
    })
  })
})
