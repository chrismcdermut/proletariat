import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'

import {
  cleanupFailedAgentSpawn,
  createEphemeralAgent,
  type WorkspaceInfo,
} from '../../src/lib/agents/commands.js'
import {
  CREATE_TABLES_SQL,
  getEphemeralAgentNames,
} from '../../src/lib/database/index.js'

/**
 * PRLT-1322: When the Docker spawn pipeline fails, we must clean up the
 * ephemeral agent state — DB row, on-disk worktree, container, image —
 * so the next invocation doesn't leave behind "ghost" agents.
 */
describe('cleanupFailedAgentSpawn (PRLT-1322)', () => {
  let testDir: string

  function setupWorkspaceDb(workspacePath: string): void {
    const dbDir = path.join(workspacePath, '.proletariat')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'workspace.db')
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    db.exec(CREATE_TABLES_SQL)
    db.prepare(`
      INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-workspace', 0, ?)
    `).run(new Date().toISOString())
    db.close()
  }

  function makeWorkspaceInfo(workspacePath: string): WorkspaceInfo {
    return {
      path: workspacePath,
      type: 'hq',
      workspaceName: 'test-workspace',
      hasPMO: false,
      agents: [],
      repositories: [{
        name: 'proletariat',
        path: path.join(workspacePath, 'repos', 'proletariat'),
        type: 'main',
        added_at: new Date().toISOString(),
      }],
      agentsPath: path.join(workspacePath, 'agents', 'staff'),
      activeThemeId: null,
      persistentAgentsDir: 'staff',
      ephemeralAgentsDir: 'temp',
    }
  }

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-failed-spawn-'))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('removes the DB row so the same name can be generated again', async () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    // Create a real git repo so createEphemeralAgent succeeds end-to-end
    const reposDir = path.join(testDir, 'repos', 'proletariat')
    fs.mkdirSync(reposDir, { recursive: true })
    execSync('git init -q', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.name "test"', { cwd: reposDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(reposDir, 'README.md'), '# test\n')
    execSync('git add README.md', { cwd: reposDir, stdio: 'pipe' })
    execSync('git commit -q -m init', { cwd: reposDir, stdio: 'pipe' })

    const result = await createEphemeralAgent(workspaceInfo, {
      skipDevcontainer: true,
      mountMode: 'worktree',
    })

    const agentName = result.name
    expect(getEphemeralAgentNames(testDir).has(agentName.toLowerCase())).to.equal(true)
    expect(fs.existsSync(result.worktreePath)).to.equal(true)

    // Simulate pipeline failure → call cleanupFailedAgentSpawn
    cleanupFailedAgentSpawn(workspaceInfo, agentName, { mountMode: 'worktree' })

    // DB row is gone
    expect(getEphemeralAgentNames(testDir).has(agentName.toLowerCase())).to.equal(false)
    // Directory is gone
    expect(fs.existsSync(result.worktreePath)).to.equal(false)
  })

  it('is idempotent when the agent was never created', () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    // Agent "ghost-bezos-99" was never created — cleanup must not throw.
    expect(() => {
      cleanupFailedAgentSpawn(workspaceInfo, 'ghost-bezos-99', { mountMode: 'worktree' })
    }).to.not.throw()
  })

  it('calls the provided log callback for each cleanup step it performs', async () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    const reposDir = path.join(testDir, 'repos', 'proletariat')
    fs.mkdirSync(reposDir, { recursive: true })
    execSync('git init -q', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.name "test"', { cwd: reposDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(reposDir, 'README.md'), '# test\n')
    execSync('git add README.md', { cwd: reposDir, stdio: 'pipe' })
    execSync('git commit -q -m init', { cwd: reposDir, stdio: 'pipe' })

    const result = await createEphemeralAgent(workspaceInfo, {
      skipDevcontainer: true,
      mountMode: 'worktree',
    })

    const logged: string[] = []
    cleanupFailedAgentSpawn(workspaceInfo, result.name, {
      mountMode: 'worktree',
      log: (msg) => logged.push(msg),
    })

    expect(logged.some(m => m.includes('Removed agent dir'))).to.equal(true)
    expect(logged.some(m => m.includes('workspace DB'))).to.equal(true)
  })
})
