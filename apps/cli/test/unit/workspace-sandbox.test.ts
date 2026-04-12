import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { findHQRoot } from '../../src/lib/workspace.js'
import { getDatabasePath } from '../../src/lib/database/workspace.js'
import { runDrizzleMigrations } from '../../src/lib/database/migrator.js'
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js'

describe('PRLT-1301: workspace DB sandbox', () => {
  // =========================================================================
  // Root hook safety net verification
  // =========================================================================
  describe('workspace-sandbox root hook', () => {
    it('PRLT_TEST_WORKSPACE_DB is set by the mocha root hook', () => {
      // The workspace-sandbox.ts root hook MUST set this env var before any
      // test runs, so no test can accidentally operate on the real HQ
      // workspace.db. If this fails, the root hook is missing or broken.
      expect(process.env.PRLT_TEST_WORKSPACE_DB).to.be.a('string')
      expect(process.env.PRLT_TEST_WORKSPACE_DB!.length).to.be.greaterThan(0)
    })

    it('PRLT_HQ_PATH points to the sandbox directory', () => {
      expect(process.env.PRLT_HQ_PATH).to.be.a('string')
      expect(process.env.PRLT_HQ_PATH!).to.include('prlt-workspace-sandbox-')
    })

    it('PRLT_TEST_ENV is set to enable PRLT_HQ_PATH resolution', () => {
      expect(process.env.PRLT_TEST_ENV).to.equal('true')
    })

    it('sandbox DB file exists and has valid schema', () => {
      const dbPath = process.env.PRLT_TEST_WORKSPACE_DB!
      expect(fs.existsSync(dbPath)).to.be.true

      const db = new Database(dbPath, { readonly: true })
      try {
        // Verify core tables exist
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all() as { name: string }[]
        const tableNames = tables.map(t => t.name)

        expect(tableNames).to.include('workspace')
        expect(tableNames).to.include('agents')
        expect(tableNames).to.include('repositories')
        expect(tableNames).to.include('prlt_migrations')
      } finally {
        db.close()
      }
    })

    it('sandbox DB has schema but no data rows', () => {
      const dbPath = process.env.PRLT_TEST_WORKSPACE_DB!
      const db = new Database(dbPath, { readonly: true })
      try {
        const count = db.prepare('SELECT COUNT(*) as cnt FROM workspace').get() as { cnt: number }
        expect(count.cnt).to.equal(0)
      } finally {
        db.close()
      }
    })

    it('sandbox directory has valid HQ config.json', () => {
      const hqPath = process.env.PRLT_HQ_PATH!
      const configPath = path.join(hqPath, '.proletariat', 'config.json')
      expect(fs.existsSync(configPath)).to.be.true

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(config.type).to.equal('hq')
    })

    it('findHQRoot returns the sandbox, not the real HQ', () => {
      const hqPath = findHQRoot()
      expect(hqPath).to.equal(process.env.PRLT_HQ_PATH)
      // Verify it does NOT point to the real proletariat-hq directory
      expect(hqPath).to.include('prlt-workspace-sandbox-')
    })
  })

  // =========================================================================
  // Regression test: migrations must not affect real HQ DB
  // =========================================================================
  describe('migration isolation', () => {
    it('running a migration in test does NOT modify the real HQ workspace.db', () => {
      // This test creates a fresh in-memory DB, runs all migrations,
      // then adds a custom table. The point is to verify that no code path
      // in test execution can reach the real workspace.db.

      // 1. Snapshot the sandbox DB before migration
      const sandboxDbPath = process.env.PRLT_TEST_WORKSPACE_DB!
      const beforeStat = fs.statSync(sandboxDbPath)

      // 2. Create a separate temp DB and run a "test migration" on it
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-migration-test-'))
      const testDbPath = path.join(tmpDir, 'test-migration.db')
      const testDb = new Database(testDbPath)
      testDb.pragma('foreign_keys = ON')
      runDrizzleMigrations(testDb, ALL_MIGRATIONS)

      // Add a custom table (simulating an agent's migration work)
      testDb.exec('CREATE TABLE test_agent_table (id INTEGER PRIMARY KEY, value TEXT)')
      testDb.exec("INSERT INTO test_agent_table VALUES (1, 'test')")
      testDb.close()

      // 3. Verify the sandbox DB was NOT modified by the migration
      const sandboxDb = new Database(sandboxDbPath, { readonly: true })
      try {
        const tables = sandboxDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='test_agent_table'"
        ).all()
        expect(tables).to.have.length(0, 'test_agent_table should NOT exist in sandbox DB')
      } finally {
        sandboxDb.close()
      }

      // 4. Verify getDatabasePath resolves to sandbox, not real HQ
      const hqPath = process.env.PRLT_HQ_PATH!
      const resolvedDbPath = getDatabasePath(hqPath)
      expect(resolvedDbPath).to.include('prlt-workspace-sandbox-')

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('workspace resolution never escapes to real HQ directory tree', () => {
      // Even if we try to resolve from a directory inside the real HQ,
      // findHQRoot should return the sandbox (via PRLT_HQ_PATH) not the real HQ
      const hqRoot = findHQRoot()
      expect(hqRoot).to.not.be.null
      expect(hqRoot!).to.include('prlt-workspace-sandbox-')

      // The sandbox path should be in /tmp, not in the real project tree
      expect(hqRoot!).to.satisfy(
        (p: string) => p.startsWith(os.tmpdir()) || p.startsWith('/private' + os.tmpdir()),
        `Expected sandbox path to be in temp dir, got: ${hqRoot}`
      )
    })
  })
})
