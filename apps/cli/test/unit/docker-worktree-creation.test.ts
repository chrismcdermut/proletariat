import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'

import { createEphemeralAgent, type WorkspaceInfo } from '../../src/lib/agents/commands.js'
import { createAgentWorktrees } from '../../src/lib/agents/index.js'
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js'

/**
 * PRLT-1331: Docker agent worktree creation must fail loudly instead of
 * silently producing empty agent directories. Validates both
 * createAgentWorktrees (staff path) and createEphemeralAgent (ephemeral path).
 */
describe('Docker agent worktree creation (PRLT-1331)', () => {
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

  function addRepoToDb(workspacePath: string, repoName: string): void {
    const dbPath = path.join(workspacePath, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    db.prepare(`
      INSERT OR IGNORE INTO repositories (name, path, type, added_at)
      VALUES (?, ?, 'main', ?)
    `).run(repoName, `repos/${repoName}`, new Date().toISOString())
    db.close()
  }

  function makeWorkspaceInfo(workspacePath: string, repos: Array<{ name: string }> = []): WorkspaceInfo {
    return {
      path: workspacePath,
      type: 'hq',
      workspaceName: 'test-workspace',
      hasPMO: false,
      agents: [],
      repositories: repos.map(r => ({
        name: r.name,
        path: path.join(workspacePath, 'repos', r.name),
        type: 'main' as const,
        added_at: new Date().toISOString(),
      })),
      agentsPath: path.join(workspacePath, 'agents', 'staff'),
      activeThemeId: null,
      persistentAgentsDir: 'staff',
      ephemeralAgentsDir: 'temp',
    }
  }

  function createGitRepo(repoPath: string): void {
    fs.mkdirSync(repoPath, { recursive: true })
    execSync('git init -q', { cwd: repoPath, stdio: 'pipe' })
    execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'pipe' })
    execSync('git config user.name "test"', { cwd: repoPath, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# test repo\n')
    execSync('git add README.md', { cwd: repoPath, stdio: 'pipe' })
    execSync('git commit -q -m init', { cwd: repoPath, stdio: 'pipe' })
  }

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-worktree-creation-'))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('createAgentWorktrees — error propagation', () => {
    it('throws when source repo does not exist on disk', async () => {
      setupWorkspaceDb(testDir)
      addRepoToDb(testDir, 'proletariat')

      const agentsPath = path.join(testDir, 'agents', 'staff')
      fs.mkdirSync(agentsPath, { recursive: true })

      let caught: unknown
      try {
        await createAgentWorktrees(agentsPath, ['test-agent'], testDir, {
          skipDevcontainer: true,
        })
      } catch (err) {
        caught = err
      }

      expect(caught, 'expected createAgentWorktrees to throw when no repos created').to.exist
      const message = caught instanceof Error ? caught.message : String(caught)
      expect(message).to.match(/No repositories were created/)
    })

    it('throws when source repo has no commits', async () => {
      setupWorkspaceDb(testDir)
      addRepoToDb(testDir, 'proletariat')
      const repoPath = path.join(testDir, 'repos', 'proletariat')
      fs.mkdirSync(repoPath, { recursive: true })
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# not a git repo\n')

      const agentsPath = path.join(testDir, 'agents', 'staff')
      fs.mkdirSync(agentsPath, { recursive: true })

      let caught: unknown
      try {
        await createAgentWorktrees(agentsPath, ['test-agent'], testDir, {
          skipDevcontainer: true,
        })
      } catch (err) {
        caught = err
      }

      expect(caught, 'expected createAgentWorktrees to throw').to.exist
      const message = caught instanceof Error ? caught.message : String(caught)
      expect(message).to.match(/No repositories were created/)
    })

    it('succeeds and creates worktree from a real git repo', async () => {
      setupWorkspaceDb(testDir)
      addRepoToDb(testDir, 'proletariat')
      createGitRepo(path.join(testDir, 'repos', 'proletariat'))

      const agentsPath = path.join(testDir, 'agents', 'staff')
      fs.mkdirSync(agentsPath, { recursive: true })

      await createAgentWorktrees(agentsPath, ['test-agent'], testDir, {
        skipDevcontainer: true,
      })

      const worktreeDir = path.join(agentsPath, 'test-agent', 'proletariat')
      expect(fs.existsSync(worktreeDir), 'worktree dir exists').to.equal(true)
      const entries = fs.readdirSync(worktreeDir)
      expect(entries, 'worktree is non-empty').to.include('README.md')
    })
  })

  describe('createEphemeralAgent — empty repositories list', () => {
    it('throws when repos/ has directories but DB repositories list is empty', async () => {
      setupWorkspaceDb(testDir)
      createGitRepo(path.join(testDir, 'repos', 'proletariat'))

      const workspaceInfo = makeWorkspaceInfo(testDir, [])

      let caught: unknown
      try {
        await createEphemeralAgent(workspaceInfo, {
          skipDevcontainer: true,
          mountMode: 'worktree',
        })
      } catch (err) {
        caught = err
      }

      expect(caught, 'expected createEphemeralAgent to throw on empty repos list').to.exist
      const message = caught instanceof Error ? caught.message : String(caught)
      expect(message).to.match(/No repositories registered/)
      expect(message).to.match(/proletariat/)
    })

    it('cleans up agent dir after detecting empty repos list', async () => {
      setupWorkspaceDb(testDir)
      createGitRepo(path.join(testDir, 'repos', 'proletariat'))

      const workspaceInfo = makeWorkspaceInfo(testDir, [])
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

      expect(after.filter(n => !before.includes(n))).to.deep.equal([])
    })
  })

  describe('createEphemeralAgent — success path', () => {
    it('creates a populated worktree in agents/temp/<name>/<repo>', async () => {
      setupWorkspaceDb(testDir)
      addRepoToDb(testDir, 'proletariat')
      createGitRepo(path.join(testDir, 'repos', 'proletariat'))

      const workspaceInfo = makeWorkspaceInfo(testDir, [{ name: 'proletariat' }])

      const result = await createEphemeralAgent(workspaceInfo, {
        skipDevcontainer: true,
        mountMode: 'worktree',
      })

      const worktreeDir = path.join(result.worktreePath, 'proletariat')
      expect(fs.existsSync(worktreeDir), 'worktree dir exists').to.equal(true)
      const entries = fs.readdirSync(worktreeDir)
      expect(entries, 'worktree contains repo files').to.include('README.md')
    })
  })
})
