import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'

import { createEphemeralAgent, type WorkspaceInfo } from '../../src/lib/agents/commands.js'
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js'

/**
 * PRLT-1322: createEphemeralAgent must fail loudly when worktree creation
 * fails. Previously it would silently fall back to an empty directory, causing
 * agent containers to launch with empty /workspace and no code to work on.
 */
describe('createEphemeralAgent — worktree failure (PRLT-1322)', () => {
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
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ephemeral-worktree-failure-'))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('throws when the source repo is not a git repo (worktree mode)', async () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    // Create `repos/proletariat` but NOT a git repo — `git worktree add`
    // will fail. Previously this was silently turned into an empty fallback
    // directory; PRLT-1322 makes it throw loudly.
    const reposDir = path.join(testDir, 'repos', 'proletariat')
    fs.mkdirSync(reposDir, { recursive: true })
    fs.writeFileSync(path.join(reposDir, 'README.md'), '# not a git repo\n')

    let caught: unknown
    try {
      await createEphemeralAgent(workspaceInfo, {
        skipDevcontainer: true,
        mountMode: 'worktree',
      })
    } catch (err) {
      caught = err
    }

    expect(caught, 'expected createEphemeralAgent to throw on worktree failure').to.exist
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).to.match(/Failed to populate agent workspace/)
    expect(message).to.match(/proletariat/)
    expect(message).to.match(/empty \/workspace/i)
  })

  it('cleans up the partial agent directory after a worktree failure', async () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    const reposDir = path.join(testDir, 'repos', 'proletariat')
    fs.mkdirSync(reposDir, { recursive: true })

    const agentsTempDir = path.join(testDir, 'agents', 'temp')
    const before = fs.existsSync(agentsTempDir)
      ? fs.readdirSync(agentsTempDir)
      : []

    try {
      await createEphemeralAgent(workspaceInfo, {
        skipDevcontainer: true,
        mountMode: 'worktree',
      })
    } catch {
      // expected
    }

    const after = fs.existsSync(agentsTempDir)
      ? fs.readdirSync(agentsTempDir)
      : []

    // Before == after: the failed attempt's directory was cleaned up and
    // didn't leave a ghost agent directory behind.
    expect(after.filter(n => !before.includes(n))).to.deep.equal([])
  })

  it('succeeds and populates the worktree when source is a real git repo', async () => {
    setupWorkspaceDb(testDir)
    const workspaceInfo = makeWorkspaceInfo(testDir)

    // Create a real git repo with one commit so `git worktree add --detach`
    // succeeds.
    const reposDir = path.join(testDir, 'repos', 'proletariat')
    fs.mkdirSync(reposDir, { recursive: true })
    execSync('git init -q', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: reposDir, stdio: 'pipe' })
    execSync('git config user.name "test"', { cwd: reposDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(reposDir, 'README.md'), '# real repo\n')
    execSync('git add README.md', { cwd: reposDir, stdio: 'pipe' })
    execSync('git commit -q -m init', { cwd: reposDir, stdio: 'pipe' })

    const result = await createEphemeralAgent(workspaceInfo, {
      skipDevcontainer: true,
      mountMode: 'worktree',
    })

    const worktreeDir = path.join(result.worktreePath, 'proletariat')
    expect(fs.existsSync(worktreeDir), 'worktree dir exists').to.equal(true)
    const entries = fs.readdirSync(worktreeDir)
    expect(entries, 'worktree is non-empty').to.include('README.md')
  })
})
