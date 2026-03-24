/**
 * Workspace detection consistency tests (PRLT-1105).
 *
 * Regression tests verifying that getWorkspaceInfo() uses the same
 * workspace resolution as findHQRoot(), preventing NOT_IN_WORKSPACE
 * errors when the workspace is actually valid.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { findHQRoot } from '../../src/lib/workspace.js'
import { getWorkspaceInfo } from '../../src/lib/agents/commands.js'
import { createWorkspaceDatabase } from '../../src/lib/database/index.js'

describe('PRLT-1105: Workspace detection consistency', () => {
  let tmpDir: string
  let originalCwd: string
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalCwd = process.cwd()
    // Use realpathSync to resolve macOS /var -> /private/var symlinks
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-ws-detect-')))

    // Save and clear environment variables that affect workspace detection
    originalEnv = {
      PRLT_HQ_PATH: process.env.PRLT_HQ_PATH,
      DEVCONTAINER: process.env.DEVCONTAINER,
      PRLT_TEST_ENV: process.env.PRLT_TEST_ENV,
    }
    delete process.env.PRLT_HQ_PATH
    delete process.env.DEVCONTAINER
    delete process.env.PRLT_TEST_ENV
  })

  afterEach(() => {
    process.chdir(originalCwd)
    // Restore environment variables
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  /**
   * Helper to create a valid HQ workspace with config.json and database.
   * Mimics what `prlt new` does (initializeHQDatabase).
   */
  function createValidHQ(hqPath: string, name = 'test-hq'): void {
    const proletariatDir = path.join(hqPath, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    // Create the database (this writes a bootstrap config.json without type)
    const db = createWorkspaceDatabase(hqPath, 'hq', name, false)
    db.close()

    // Write the HQ config.json (required for findHQRoot detection)
    const configPath = path.join(proletariatDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      version: '1.0.0',
      schemaVersion: 1,
      type: 'hq',
      name,
    }, null, 2))

    // Create agents directories
    fs.mkdirSync(path.join(hqPath, 'agents', 'staff'), { recursive: true })
    fs.mkdirSync(path.join(hqPath, 'agents', 'temp'), { recursive: true })
  }

  // =========================================================================
  // Core regression: getWorkspaceInfo must succeed when findHQRoot succeeds
  // =========================================================================

  it('getWorkspaceInfo() succeeds when findHQRoot() succeeds (from HQ root)', () => {
    createValidHQ(tmpDir)
    process.chdir(tmpDir)

    // findHQRoot should find the workspace
    const hqPath = findHQRoot()
    expect(hqPath).to.equal(tmpDir)

    // getWorkspaceInfo must also find it — this was the PRLT-1105 bug
    const wsInfo = getWorkspaceInfo()
    expect(wsInfo.path).to.equal(tmpDir)
    expect(wsInfo.type).to.equal('hq')
  })

  it('getWorkspaceInfo() succeeds when findHQRoot() succeeds (from subdirectory)', () => {
    createValidHQ(tmpDir)
    const subDir = path.join(tmpDir, 'agents', 'staff')
    process.chdir(subDir)

    const hqPath = findHQRoot()
    expect(hqPath).to.equal(tmpDir)

    const wsInfo = getWorkspaceInfo()
    expect(wsInfo.path).to.equal(tmpDir)
    expect(wsInfo.type).to.equal('hq')
  })

  // =========================================================================
  // Error quality: descriptive errors when DB exists but is unreadable
  // =========================================================================

  it('throws descriptive error when config.json exists but DB is missing', () => {
    const proletariatDir = path.join(tmpDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    // Write config.json with type='hq' but NO database file
    fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
      type: 'hq',
      name: 'test-hq',
    }))

    process.chdir(tmpDir)

    expect(() => getWorkspaceInfo()).to.throw(/database is missing/)
  })

  it('throws descriptive error when workspace table is empty', () => {
    const proletariatDir = path.join(tmpDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    // Write config.json
    fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
      type: 'hq',
      name: 'test-hq',
    }))

    // Create an empty database (no workspace row)
    const dbPath = path.join(proletariatDir, 'workspace.db')
    const db = new Database(dbPath)
    db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, type TEXT, workspace_name TEXT, has_pmo INTEGER, active_theme_id TEXT, created_at TEXT)')
    db.close()

    process.chdir(tmpDir)

    expect(() => getWorkspaceInfo()).to.throw(/could not read workspace configuration/)
  })

  it('does NOT throw generic "not in workspace" when DB exists but config is unreadable', () => {
    createValidHQ(tmpDir)
    process.chdir(tmpDir)

    // Corrupt the database by overwriting with garbage
    const dbPath = path.join(tmpDir, '.proletariat', 'workspace.db')
    fs.writeFileSync(dbPath, 'this is not a database')

    try {
      getWorkspaceInfo()
      // Should not reach here
      expect.fail('Expected getWorkspaceInfo to throw')
    } catch (error: unknown) {
      const message = (error as Error).message
      // Must NOT say "Run prlt new" — the workspace exists, the DB is just broken
      expect(message).to.not.include('Run "prlt new" first')
      // Should mention the workspace path or recovery steps
      expect(message).to.match(/could not read|database|repair/i)
    }
  })

  // =========================================================================
  // Consistency: both functions agree on workspace location
  // =========================================================================

  it('getWorkspaceInfo().path matches findHQRoot() for valid HQ', () => {
    createValidHQ(tmpDir)
    process.chdir(tmpDir)

    const hqRoot = findHQRoot()
    const wsInfo = getWorkspaceInfo()

    expect(wsInfo.path).to.equal(hqRoot)
  })

  it('getWorkspaceInfo works via PRLT_HQ_PATH in test environment', () => {
    createValidHQ(tmpDir)

    // Simulate test environment with PRLT_HQ_PATH
    process.env.PRLT_TEST_ENV = 'true'
    process.env.PRLT_HQ_PATH = tmpDir

    // Change to a directory that is NOT inside the HQ
    const otherDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-other-')))
    process.chdir(otherDir)

    try {
      const hqRoot = findHQRoot()
      expect(hqRoot).to.equal(tmpDir)

      const wsInfo = getWorkspaceInfo()
      expect(wsInfo.path).to.equal(tmpDir)
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // Workspace.db fallback: non-HQ workspaces still detected
  // =========================================================================

  it('falls back to workspace.db walk for non-HQ workspace types', () => {
    const proletariatDir = path.join(tmpDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })

    // Create a workspace-type DB (not 'hq') — config.json does NOT have type='hq'
    const db = createWorkspaceDatabase(tmpDir, 'workspace', 'test-ws', false)
    db.close()

    // Config.json left as bootstrap (no type='hq'), so isValidHQ returns false
    // But getWorkspaceInfo should still find it via workspace.db walk
    process.chdir(tmpDir)

    // getWorkspaceInfo should find the local non-HQ workspace via workspace.db
    const wsInfo = getWorkspaceInfo()
    expect(wsInfo.path).to.equal(tmpDir)
    expect(wsInfo.type).to.equal('workspace')
  })
})
