/**
 * Regression test for PRLT-1090
 *
 * Verifies that the CLI can open workspace databases in read-only mode
 * when running inside agent containers, preventing EACCES errors on
 * read-only HQ mounts.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { openWorkspaceDatabase } from '../../src/lib/database/workspace.js'
import { runDrizzleMigrations } from '../../src/lib/database/migrator.js'
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js'

describe('PRLT-1090: container read-only database access', () => {
  const originalEnv = { ...process.env }
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-1090-'))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createTestWorkspace(workspacePath: string): void {
    const proletariatDir = path.join(workspacePath, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    const dbPath = path.join(proletariatDir, 'workspace.db')
    const db = new SqliteDatabase(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runDrizzleMigrations(db, ALL_MIGRATIONS)

    // Insert workspace config row
    db.exec(`
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 0, datetime('now'))
    `)

    // Checkpoint WAL to main database file so read-only opens work
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()

    // Write config.json
    fs.writeFileSync(
      path.join(proletariatDir, 'config.json'),
      JSON.stringify({ version: '1.0.0', type: 'hq', schemaVersion: 1 })
    )
  }

  /**
   * Simulate container environment by setting env vars.
   * PRLT_HQ_PATH must point to the workspace for read-only detection to trigger.
   */
  function simulateContainer(hqPath: string): void {
    process.env.PRLT_AGENT_NAME = 'test-agent-1'
    process.env.DEVCONTAINER = 'true'
    process.env.PRLT_HQ_PATH = hqPath
  }

  it('should open database read-only when in container with matching PRLT_HQ_PATH', () => {
    createTestWorkspace(tmpDir)
    simulateContainer(tmpDir)

    const db = openWorkspaceDatabase(tmpDir)
    expect(db).to.exist

    // Should be able to read
    const row = db.prepare('SELECT workspace_name FROM workspace WHERE id = 1').get() as { workspace_name: string }
    expect(row.workspace_name).to.equal('test-hq')

    db.close()
  })

  it('should not create backup files in container mode', () => {
    createTestWorkspace(tmpDir)
    simulateContainer(tmpDir)

    const db = openWorkspaceDatabase(tmpDir)
    db.close()

    // Verify no backup files were created
    const dbDir = path.join(tmpDir, '.proletariat')
    const files = fs.readdirSync(dbDir)
    const backupFiles = files.filter(f => f.includes('.backup.'))
    expect(backupFiles).to.have.length(0)
  })

  it('should reject writes in container mode (read-only db)', () => {
    createTestWorkspace(tmpDir)
    simulateContainer(tmpDir)

    const db = openWorkspaceDatabase(tmpDir)

    // Attempting to write should fail
    expect(() => {
      db.exec("UPDATE workspace SET workspace_name = 'modified' WHERE id = 1")
    }).to.throw(/readonly/)

    db.close()
  })

  it('should succeed with read-only .proletariat dir in container mode', () => {
    // Create workspace with journal_mode=delete so no WAL/SHM files are needed.
    const proletariatDir = path.join(tmpDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    const dbPath = path.join(proletariatDir, 'workspace.db')
    const db = new SqliteDatabase(dbPath)
    db.pragma('journal_mode = delete')
    db.pragma('foreign_keys = ON')
    runDrizzleMigrations(db, ALL_MIGRATIONS)
    db.exec(`
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 0, datetime('now'))
    `)
    db.close()

    fs.writeFileSync(
      path.join(proletariatDir, 'config.json'),
      JSON.stringify({ version: '1.0.0', type: 'hq', schemaVersion: 1 })
    )

    // Make .proletariat read-only to simulate container mount
    fs.chmodSync(dbPath, 0o444)
    fs.chmodSync(path.join(proletariatDir, 'config.json'), 0o444)
    fs.chmodSync(proletariatDir, 0o555)

    simulateContainer(tmpDir)

    try {
      const rodb = openWorkspaceDatabase(tmpDir)
      expect(rodb).to.exist

      const row = rodb.prepare('SELECT workspace_name FROM workspace WHERE id = 1').get() as { workspace_name: string }
      expect(row.workspace_name).to.equal('test-hq')

      rodb.close()
    } finally {
      // Restore permissions for cleanup
      fs.chmodSync(proletariatDir, 0o755)
      fs.chmodSync(dbPath, 0o644)
      fs.chmodSync(path.join(proletariatDir, 'config.json'), 0o644)
    }
  })

  it('should open writable database when not in container', () => {
    createTestWorkspace(tmpDir)

    // Ensure container env vars are not set
    delete process.env.PRLT_AGENT_NAME
    delete process.env.DEVCONTAINER
    delete process.env.PRLT_HQ_PATH

    const db = openWorkspaceDatabase(tmpDir)
    expect(db).to.exist

    // Should create backup files
    const dbDir = path.join(tmpDir, '.proletariat')
    const files = fs.readdirSync(dbDir)
    const backupFiles = files.filter(f => f.includes('.backup.'))
    expect(backupFiles.length).to.be.greaterThan(0)

    db.close()
  })

  it('should open writable database in container when path does not match PRLT_HQ_PATH', () => {
    createTestWorkspace(tmpDir)

    // Set container env but with a different HQ path
    process.env.PRLT_AGENT_NAME = 'test-agent-1'
    process.env.DEVCONTAINER = 'true'
    process.env.PRLT_HQ_PATH = '/some/other/hq'

    const db = openWorkspaceDatabase(tmpDir)
    expect(db).to.exist

    // Should create backup files since this is not the read-only HQ mount
    const dbDir = path.join(tmpDir, '.proletariat')
    const files = fs.readdirSync(dbDir)
    const backupFiles = files.filter(f => f.includes('.backup.'))
    expect(backupFiles.length).to.be.greaterThan(0)

    db.close()
  })

  it('should support explicit readonly option override', () => {
    createTestWorkspace(tmpDir)

    // Not in container, but explicitly request readonly
    delete process.env.PRLT_AGENT_NAME
    delete process.env.DEVCONTAINER

    const db = openWorkspaceDatabase(tmpDir, { readonly: true })
    expect(db).to.exist

    expect(() => {
      db.exec("UPDATE workspace SET workspace_name = 'modified' WHERE id = 1")
    }).to.throw(/readonly/)

    db.close()
  })
})
