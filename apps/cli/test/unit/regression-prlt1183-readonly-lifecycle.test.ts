/**
 * Regression test for PRLT-1183
 *
 * Verifies that lifecycle commands (work propose/ready/ship/complete) work
 * in container environments where the HQ database is mounted read-only.
 *
 * Root causes fixed:
 * 1. SQLiteStorage opened workspace.db in read-write mode in containers,
 *    crashing even read-only commands like `ticket show`.
 * 2. ExecutionStorage.updateStatus() crashed with SQLITE_READONLY when
 *    lifecycle commands tried to mark executions as completed.
 * 3. moveTicketByIntent() failed entirely on SQLITE_READONLY instead of
 *    falling through to the external provider sync.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { runDrizzleMigrations } from '../../src/lib/database/migrator.js'
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_SCHEMA_SQL } from '../../src/lib/pmo/schema.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage/index.js'

describe('PRLT-1183: read-only HQ mount graceful degradation', () => {
  const originalEnv = { ...process.env }
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-1183-'))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * Create a test workspace with workspace.db and PMO tables.
   */
  function createTestWorkspace(workspacePath: string): void {
    const proletariatDir = path.join(workspacePath, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    const dbPath = path.join(proletariatDir, 'workspace.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runDrizzleMigrations(db, ALL_MIGRATIONS)

    // Insert workspace config
    db.exec(`
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 1, datetime('now'))
    `)

    // Create PMO tables
    db.exec(PMO_SCHEMA_SQL)

    // Create a test execution record
    db.exec(`
      INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, display_mode, permission_mode, status, started_at)
      VALUES ('WORK-TEST0001', 'TKT-001', 'test-agent', 'claude-code', 'docker', 'terminal', 'safe', 'running', ${Date.now()})
    `)

    // Checkpoint WAL so read-only opens work
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()

    // Write config.json
    fs.writeFileSync(
      path.join(proletariatDir, 'config.json'),
      JSON.stringify({ version: '1.0.0', type: 'hq', schemaVersion: 1 })
    )
  }

  function simulateContainer(hqPath: string): void {
    process.env.PRLT_AGENT_NAME = 'test-agent-1'
    process.env.DEVCONTAINER = 'true'
    process.env.PRLT_HQ_PATH = hqPath
  }

  // =========================================================================
  // SQLiteStorage: read-only container support
  // =========================================================================

  describe('SQLiteStorage read-only mode', () => {
    it('should open PMO storage in read-only mode in container environments', () => {
      createTestWorkspace(tmpDir)
      simulateContainer(tmpDir)

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const storage = new SQLiteStorage(dbPath)

      // Should be able to read via the database
      const db = storage.getDatabase()
      const row = db.prepare('SELECT workspace_name FROM workspace WHERE id = 1').get() as { workspace_name: string }
      expect(row.workspace_name).to.equal('test-hq')

      db.close()
    })

    it('should skip ensurePMOTables in read-only mode (no crash)', () => {
      createTestWorkspace(tmpDir)
      simulateContainer(tmpDir)

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')

      // This should NOT throw — ensurePMOTables is skipped in readonly mode
      expect(() => new SQLiteStorage(dbPath)).not.to.throw()
    })

    it('should open PMO storage in read-write mode when not in container', () => {
      createTestWorkspace(tmpDir)
      delete process.env.PRLT_AGENT_NAME
      delete process.env.DEVCONTAINER
      delete process.env.PRLT_HQ_PATH

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const storage = new SQLiteStorage(dbPath)
      const db = storage.getDatabase()

      // Should be able to write
      expect(() => {
        db.exec("UPDATE workspace SET workspace_name = 'modified' WHERE id = 1")
      }).not.to.throw()

      db.close()
    })
  })

  // =========================================================================
  // ExecutionStorage.tryUpdateStatus: graceful read-only handling
  // =========================================================================

  describe('ExecutionStorage.tryUpdateStatus', () => {
    it('should return true when update succeeds on writable database', () => {
      createTestWorkspace(tmpDir)
      delete process.env.PRLT_AGENT_NAME
      delete process.env.DEVCONTAINER

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const db = new Database(dbPath)
      const storage = new ExecutionStorage(db)

      const result = storage.tryUpdateStatus('WORK-TEST0001', 'completed')
      expect(result).to.be.true

      // Verify the update actually happened
      const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-TEST0001') as { status: string }
      expect(row.status).to.equal('completed')

      db.close()
    })

    it('should return false when database is read-only (no crash)', () => {
      createTestWorkspace(tmpDir)

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const db = new Database(dbPath, { readonly: true })
      const storage = new ExecutionStorage(db)

      // tryUpdateStatus should NOT throw — it returns false
      const result = storage.tryUpdateStatus('WORK-TEST0001', 'completed')
      expect(result).to.be.false

      db.close()
    })

    it('should still throw non-readonly errors', () => {
      createTestWorkspace(tmpDir)

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const db = new Database(dbPath)
      const storage = new ExecutionStorage(db)

      // Drop the table to cause a different error
      db.exec('DROP TABLE agent_work')

      expect(() => {
        storage.tryUpdateStatus('WORK-TEST0001', 'completed')
      }).to.throw()

      db.close()
    })
  })

  // =========================================================================
  // moveTicketByIntent: read-only graceful degradation
  // =========================================================================

  describe('moveTicketByIntent read-only handling', () => {
    it('should not crash when storage.moveTicket fails with SQLITE_READONLY', async () => {
      // This test verifies that moveTicketByIntent catches SQLITE_READONLY
      // and continues to the external provider sync
      const { moveTicketByIntent } = await import('../../src/lib/work-lifecycle/transition.js')

      createTestWorkspace(tmpDir)

      const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
      const db = new Database(dbPath)

      // Create a project and board so column resolution works
      db.exec(`
        INSERT OR IGNORE INTO pmo_projects (id, name, created_at, updated_at)
        VALUES ('PROJ-001', 'Test Project', datetime('now'), datetime('now'))
      `)
      db.exec(`
        INSERT OR IGNORE INTO pmo_workflows (id, name, description, is_builtin, created_at)
        VALUES ('default', 'Default', 'Default workflow', 1, datetime('now'))
      `)
      db.exec(`
        INSERT OR IGNORE INTO pmo_workflow_statuses (id, workflow_id, name, category, position, created_at)
        VALUES
          ('ws-todo', 'default', 'To Do', 'planned', 0, datetime('now')),
          ('ws-done', 'default', 'Done', 'completed', 2, datetime('now'))
      `)
      db.close()

      // Reopen as read-only to simulate container
      const rodb = new Database(dbPath, { readonly: true })

      // Create a mock storage that throws SQLITE_READONLY on moveTicket
      const mockStorage = {
        getProjectBoard: async (_projectId: string) => ({
          columns: [{ name: 'To Do' }, { name: 'Done' }],
        }),
        moveTicket: async () => {
          const err = new Error('attempt to write a readonly database')
          ;(err as { code?: string }).code = 'SQLITE_READONLY'
          throw err
        },
      }

      const logs: string[] = []
      const result = await moveTicketByIntent({
        db: rodb,
        storage: mockStorage as never,
        ticket: { id: 'TKT-001', projectId: 'PROJ-001', statusName: 'To Do' },
        intent: 'completed',
        providerName: 'pmo',
        log: (msg) => logs.push(msg),
      })

      // Should not crash, and should report the readonly skip
      expect(logs.some(l => l.includes('read-only'))).to.be.true
      // moved is false because local write failed and no external provider was given
      expect(result.targetColumn).to.equal('Done')

      rodb.close()
    })
  })
})
