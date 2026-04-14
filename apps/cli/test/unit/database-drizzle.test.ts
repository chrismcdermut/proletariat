import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  CREATE_TABLES_SQL,
  createWorkspaceDatabase,
  openWorkspaceDatabase,
  getWorkspaceConfig,
  addRepositoriesToDatabase,
  getWorkspaceRepositories,
  addAgentsToDatabase,
  getWorkspaceAgents,
  getAgentByPath,
  getAgent,
  markAgentCleaned,
  markAgentRunning,
  markAgentCompleted,
  markAgentDead,
  reactivateAgent,
  pruneAgentRecords,
  RECYCLABLE_STATUSES,
  ACTIVE_STATUSES,
  removeAgentsFromDatabase,
  tryAddEphemeralAgentToDatabase,
  getEphemeralAgentNames,
  removeEphemeralAgent,
  getThemes,
  getTheme,
  createTheme,
  deleteTheme,
  getThemeNames,
  addThemeNames,
  getAvailableThemeNames,
  setActiveTheme,
  getActiveTheme,
  getAgentWorktrees,
  findWorktreesByBranch,
  getWorktreesForRepo,
  upsertWorkspaceSetting,
  addMediaItemToDatabase,
  getMediaItem,
  getWorkspaceMediaItems,
  updateMediaItemStatus,
  removeMediaItemFromDatabase,
  checkPMOExists,
  getDatabasePath,
} from '../../src/lib/database/index.js'

/**
 * Regression tests for Drizzle-first database layer (TKT-1090).
 *
 * Validates that:
 * - All runtime queries use Drizzle ORM under the hood
 * - Fresh database creation works correctly
 * - Existing databases (pre-Drizzle) are compatible via migrations
 * - All CRUD operations produce correct results
 * - Interfaces and return types are preserved
 */
describe('Database Drizzle-First Layer (TKT-1090)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-db-test-'))
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  // Helper to set up a workspace DB using the new Drizzle-first path
  function setupFreshWorkspace(type: 'hq' | 'workspace' = 'hq', name = 'test-ws'): string {
    const db = createWorkspaceDatabase(testDir, type, name, false)
    db.close()
    return testDir
  }

  // Helper to set up an "old" database using raw SQL (simulating pre-Drizzle)
  function setupLegacyWorkspace(): string {
    const dbDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'workspace.db')
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    db.exec(CREATE_TABLES_SQL)
    db.prepare(`
      INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'legacy-workspace', 0, ?)
    `).run(new Date().toISOString())
    db.close()
    return testDir
  }

  describe('Fresh database creation', () => {
    it('creates database with correct workspace config', () => {
      setupFreshWorkspace('hq', 'my-hq')
      const config = getWorkspaceConfig(testDir)
      expect(config).to.not.be.null
      expect(config!.type).to.equal('hq')
      expect(config!.workspace_name).to.equal('my-hq')
      expect(config!.has_pmo).to.equal(false)
      expect(config!.active_theme_id).to.be.null
    })

    it('creates workspace type correctly', () => {
      setupFreshWorkspace('workspace', 'my-ws')
      const config = getWorkspaceConfig(testDir)
      expect(config!.type).to.equal('workspace')
    })
  })

  describe('Legacy database compatibility', () => {
    it('opens and reads legacy database via migrations', () => {
      setupLegacyWorkspace()
      const config = getWorkspaceConfig(testDir)
      expect(config).to.not.be.null
      expect(config!.workspace_name).to.equal('legacy-workspace')
    })

    it('runs migrations on legacy database', () => {
      setupLegacyWorkspace()
      // openWorkspaceDatabase runs migrations
      const db = openWorkspaceDatabase(testDir)
      // After migration, prlt_migrations table should exist
      const migrations = db.prepare('SELECT id FROM prlt_migrations').all() as { id: string }[]
      expect(migrations.length).to.be.greaterThan(0)
      db.close()
    })
  })

  describe('Repository operations', () => {
    it('adds and retrieves repositories', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'repo-a', path: 'repos/repo-a', source_url: 'https://github.com/test/a' },
        { name: 'repo-b', path: 'repos/repo-b' },
      ])
      const repos = getWorkspaceRepositories(testDir)
      expect(repos).to.have.length(2)
      expect(repos[0].name).to.equal('repo-a')
      expect(repos[0].source_url).to.equal('https://github.com/test/a')
      expect(repos[1].name).to.equal('repo-b')
    })

    it('upserts repositories on conflict', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'repo-a', path: 'repos/repo-a' },
      ])
      addRepositoriesToDatabase(testDir, [
        { name: 'repo-a', path: 'repos/repo-a-updated', source_url: 'https://new.url' },
      ])
      const repos = getWorkspaceRepositories(testDir)
      expect(repos).to.have.length(1)
      expect(repos[0].path).to.equal('repos/repo-a-updated')
      expect(repos[0].source_url).to.equal('https://new.url')
    })
  })

  describe('Agent operations', () => {
    it('adds persistent agents', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'myrepo', path: 'repos/myrepo' },
      ])
      addAgentsToDatabase(testDir, ['agent1', 'agent2'])
      const agents = getWorkspaceAgents(testDir)
      expect(agents).to.have.length(2)
      expect(agents[0].type).to.equal('persistent')
      expect(agents[0].status).to.equal('active')
    })

    it('skips duplicate agents (case-insensitive)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['agent1'])
      addAgentsToDatabase(testDir, ['Agent1']) // same name, different case
      const agents = getWorkspaceAgents(testDir)
      expect(agents).to.have.length(1)
    })

    it('creates worktrees for agents', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'myrepo', path: 'repos/myrepo' },
      ])
      addAgentsToDatabase(testDir, ['worker'])
      const worktrees = getAgentWorktrees(testDir, 'worker')
      expect(worktrees).to.have.length(1)
      expect(worktrees[0].repo_name).to.equal('myrepo')
      expect(worktrees[0].branch).to.equal('agent-worker')
    })

    it('marks agent as cleaned', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentCleaned(testDir, 'worker')
      const active = getWorkspaceAgents(testDir, false)
      expect(active).to.have.length(0)
      const all = getWorkspaceAgents(testDir, true)
      expect(all).to.have.length(1)
      expect(all[0].status).to.equal('cleaned')
      expect(all[0].cleaned_at).to.not.be.null
    })

    it('removes agents from database', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['a1', 'a2', 'a3'])
      removeAgentsFromDatabase(testDir, ['a1', 'a3'])
      const agents = getWorkspaceAgents(testDir)
      expect(agents).to.have.length(1)
      expect(agents[0].name).to.equal('a2')
    })

    it('gets agent by path', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'myrepo', path: 'repos/myrepo' },
      ])
      addAgentsToDatabase(testDir, ['worker'])
      const agent = getAgentByPath(testDir, path.join(testDir, 'agents/staff/worker/some-file'))
      expect(agent).to.not.be.null
      expect(agent!.name).to.equal('worker')
    })

    it('returns null for path outside workspace', () => {
      setupFreshWorkspace()
      const agent = getAgentByPath(testDir, '/completely/different/path')
      expect(agent).to.be.null
    })
  })

  describe('Ephemeral agent operations', () => {
    it('adds ephemeral agent', () => {
      setupFreshWorkspace()
      const agent = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos-1', 'bezos', undefined, 'worktree')
      expect(agent).to.not.be.null
      expect(agent!.name).to.equal('bold-bezos-1')
      expect(agent!.type).to.equal('ephemeral')
      expect(agent!.base_name).to.equal('bezos')
      expect(agent!.worktree_path).to.equal('agents/temp/bold-bezos-1')
    })

    it('returns null on duplicate name', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos-1', 'bezos')
      const duplicate = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos-1', 'bezos')
      expect(duplicate).to.be.null
    })

    it('gets ephemeral agent names', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos-1', 'bezos')
      tryAddEphemeralAgentToDatabase(testDir, 'cool-musk-2', 'musk')
      const names = getEphemeralAgentNames(testDir)
      expect(names.size).to.equal(2)
      expect(names.has('bold-bezos-1')).to.be.true
      expect(names.has('cool-musk-2')).to.be.true
    })

    it('removes ephemeral agent', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos-1', 'bezos')
      removeEphemeralAgent(testDir, 'bold-bezos-1')
      const names = getEphemeralAgentNames(testDir)
      expect(names.size).to.equal(0)
    })
  })

  describe('Theme operations', () => {
    it('creates and retrieves a theme', () => {
      setupFreshWorkspace()
      const theme = createTheme(testDir, {
        id: 'test-theme',
        name: 'test-theme',
        displayName: 'Test Theme',
        description: 'A test theme',
        builtin: false,
      })
      expect(theme.id).to.equal('test-theme')
      expect(theme.display_name).to.equal('Test Theme')

      const retrieved = getTheme(testDir, 'test-theme')
      expect(retrieved).to.not.be.null
      expect(retrieved!.name).to.equal('test-theme')
    })

    it('lists all themes', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 't1', name: 'theme1', displayName: 'Theme 1' })
      createTheme(testDir, { id: 't2', name: 'theme2', displayName: 'Theme 2' })
      const themes = getThemes(testDir)
      expect(themes.length).to.be.greaterThanOrEqual(2)
    })

    it('deletes a non-builtin theme', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'del-me', name: 'deletable', displayName: 'Deletable' })
      const deleted = deleteTheme(testDir, 'del-me')
      expect(deleted).to.be.true
      expect(getTheme(testDir, 'del-me')).to.be.null
    })

    it('refuses to delete builtin themes', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'builtin-t', name: 'builtin-theme', displayName: 'Builtin', builtin: true })
      expect(() => deleteTheme(testDir, 'builtin-t')).to.throw('Cannot delete built-in themes')
    })

    it('adds and retrieves theme names', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'tt', name: 'tt', displayName: 'TT' })
      addThemeNames(testDir, 'tt', ['alice', 'bob', 'charlie'])
      const names = getThemeNames(testDir, 'tt')
      expect(names).to.have.length(3)
      expect(names.map(n => n.name)).to.include.members(['alice', 'bob', 'charlie'])
    })

    it('skips duplicate theme names (case-insensitive)', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'tt', name: 'tt', displayName: 'TT' })
      addThemeNames(testDir, 'tt', ['alice', 'bob'])
      addThemeNames(testDir, 'tt', ['Alice', 'charlie']) // Alice is duplicate
      const names = getThemeNames(testDir, 'tt')
      expect(names).to.have.length(3) // alice, bob, charlie (not Alice again)
    })

    it('gets available theme names (filters out in-use agents)', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'tt', name: 'tt', displayName: 'TT' })
      addThemeNames(testDir, 'tt', ['alice', 'bob', 'charlie'])
      // No agents yet, all names should be available
      const available = getAvailableThemeNames(testDir, 'tt')
      expect(available).to.include.members(['alice', 'bob', 'charlie'])
    })

    it('sets and gets active theme', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'my-theme', name: 'my-theme', displayName: 'My Theme' })
      setActiveTheme(testDir, 'my-theme')
      const config = getWorkspaceConfig(testDir)
      expect(config!.active_theme_id).to.equal('my-theme')
    })

    it('throws when setting non-existent theme', () => {
      setupFreshWorkspace()
      expect(() => setActiveTheme(testDir, 'nonexistent')).to.throw('not found')
    })

    it('can clear active theme', () => {
      setupFreshWorkspace()
      createTheme(testDir, { id: 'my-theme', name: 'my-theme', displayName: 'My Theme' })
      setActiveTheme(testDir, 'my-theme')
      setActiveTheme(testDir, null)
      const config = getWorkspaceConfig(testDir)
      expect(config!.active_theme_id).to.be.null
    })
  })

  describe('Worktree operations', () => {
    it('finds worktrees by branch pattern', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'myrepo', path: 'repos/myrepo' },
      ])
      addAgentsToDatabase(testDir, ['worker'])
      const results = findWorktreesByBranch(testDir, '%worker%')
      expect(results.length).to.be.greaterThanOrEqual(1)
      expect(results[0].branch).to.include('worker')
    })

    it('gets worktrees for a specific repo', () => {
      setupFreshWorkspace()
      addRepositoriesToDatabase(testDir, [
        { name: 'myrepo', path: 'repos/myrepo' },
      ])
      addAgentsToDatabase(testDir, ['worker1', 'worker2'])
      const worktrees = getWorktreesForRepo(testDir, 'myrepo')
      expect(worktrees).to.have.length(2)
    })
  })

  describe('Workspace settings', () => {
    it('upserts workspace settings', () => {
      setupFreshWorkspace()
      const db = openWorkspaceDatabase(testDir)
      upsertWorkspaceSetting(db, 'test_key', 'test_value')
      const result = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('test_key') as { value: string }
      expect(result.value).to.equal('test_value')

      // Update existing key
      upsertWorkspaceSetting(db, 'test_key', 'updated_value')
      const updated = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('test_key') as { value: string }
      expect(updated.value).to.equal('updated_value')
      db.close()
    })
  })

  describe('Media item operations', () => {
    it('adds and retrieves a media item', () => {
      setupFreshWorkspace()
      addMediaItemToDatabase(testDir, {
        name: 'test-video',
        path: 'media/test.mp4',
        source_path: '/original/test.mp4',
        media_type: 'video',
        frame_interval: 15,
      })
      const item = getMediaItem(testDir, 'test-video')
      expect(item).to.not.be.null
      expect(item!.name).to.equal('test-video')
      expect(item!.path).to.equal('media/test.mp4')
      expect(item!.source_path).to.equal('/original/test.mp4')
      expect(item!.media_type).to.equal('video')
      expect(item!.frame_interval).to.equal(15)
      expect(item!.status).to.equal('pending')
    })

    it('lists all media items', () => {
      setupFreshWorkspace()
      addMediaItemToDatabase(testDir, { name: 'v1', path: 'p1', media_type: 'video' })
      addMediaItemToDatabase(testDir, { name: 'a1', path: 'p2', media_type: 'audio' })
      const items = getWorkspaceMediaItems(testDir)
      expect(items).to.have.length(2)
    })

    it('updates media item status', () => {
      setupFreshWorkspace()
      addMediaItemToDatabase(testDir, { name: 'vid', path: 'p', media_type: 'video' })
      updateMediaItemStatus(testDir, 'vid', {
        status: 'ready',
        duration_seconds: 120,
        resolution: '1920x1080',
        frame_count: 60,
        has_transcript: true,
      })
      const item = getMediaItem(testDir, 'vid')!
      expect(item.status).to.equal('ready')
      expect(item.duration_seconds).to.equal(120)
      expect(item.resolution).to.equal('1920x1080')
      expect(item.frame_count).to.equal(60)
      expect(item.has_transcript).to.be.true
      expect(item.processed_at).to.not.be.null
    })

    it('removes a media item', () => {
      setupFreshWorkspace()
      addMediaItemToDatabase(testDir, { name: 'del-me', path: 'p', media_type: 'video' })
      removeMediaItemFromDatabase(testDir, 'del-me')
      expect(getMediaItem(testDir, 'del-me')).to.be.null
    })

    it('upserts media item on conflict', () => {
      setupFreshWorkspace()
      addMediaItemToDatabase(testDir, { name: 'vid', path: 'old/path', media_type: 'video' })
      addMediaItemToDatabase(testDir, { name: 'vid', path: 'new/path', media_type: 'audio' })
      const item = getMediaItem(testDir, 'vid')!
      expect(item.path).to.equal('new/path')
      expect(item.media_type).to.equal('audio')
    })
  })

  // PRLT-1299: checkPMOExists references dead pmo_tickets table
  describe.skip('PMO bootstrap operations' /* PRLT-1299: removed */, () => {
    it('checks PMO existence on fresh DB', () => {
      setupFreshWorkspace()
      const dbPath = getDatabasePath(testDir)
      const result = checkPMOExists(dbPath)
      // After fresh workspace creation, PMO tables are created by baseline migration
      expect(result.exists).to.be.true
      expect(result.projectCount).to.equal(0)
      expect(result.ticketCount).to.equal(0)
    })
  })

  // =========================================================================
  // Agent Lifecycle States (TKT-259 / PRLT-1097)
  // =========================================================================
  describe('Agent lifecycle transitions (PRLT-1097)', () => {
    it('marks agent as running (active → running)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentRunning(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent).to.not.be.null
      expect(agent!.status).to.equal('running')
    })

    it('marks agent as completed (running → completed)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentRunning(testDir, 'worker')
      markAgentCompleted(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent).to.not.be.null
      expect(agent!.status).to.equal('completed')
      expect(agent!.cleaned_at).to.not.be.null
    })

    it('marks agent as completed from active (active → completed)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentCompleted(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('completed')
    })

    it('marks agent as dead (running → dead)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentRunning(testDir, 'worker')
      markAgentDead(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent).to.not.be.null
      expect(agent!.status).to.equal('dead')
      expect(agent!.cleaned_at).to.not.be.null
    })

    it('does not transition from completed to running (invalid)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentCompleted(testDir, 'worker')
      markAgentRunning(testDir, 'worker') // should be a no-op
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('completed')
    })

    it('does not transition from dead to completed (invalid)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentDead(testDir, 'worker')
      markAgentCompleted(testDir, 'worker') // should be a no-op
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('dead')
    })

    it('reactivates a completed agent (completed → active)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentCompleted(testDir, 'worker')
      reactivateAgent(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('active')
      expect(agent!.cleaned_at).to.be.null
    })

    it('reactivates a dead agent (dead → active)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentDead(testDir, 'worker')
      reactivateAgent(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('active')
      expect(agent!.cleaned_at).to.be.null
    })

    it('reactivates a cleaned agent (cleaned → active)', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      markAgentCleaned(testDir, 'worker')
      reactivateAgent(testDir, 'worker')
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('active')
      expect(agent!.cleaned_at).to.be.null
    })

    it('does not reactivate an already active agent', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['worker'])
      reactivateAgent(testDir, 'worker') // no-op, already active
      const agent = getAgent(testDir, 'worker')
      expect(agent!.status).to.equal('active')
    })

    it('excludes completed/dead/cleaned agents from default listing', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['a1', 'a2', 'a3'])
      markAgentCompleted(testDir, 'a1')
      markAgentDead(testDir, 'a2')
      const active = getWorkspaceAgents(testDir, false)
      expect(active).to.have.length(1)
      expect(active[0].name).to.equal('a3')
    })

    it('includes all agents when includeCleanedUp=true', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['a1', 'a2', 'a3'])
      markAgentCompleted(testDir, 'a1')
      markAgentDead(testDir, 'a2')
      const all = getWorkspaceAgents(testDir, true)
      expect(all).to.have.length(3)
    })
  })

  describe('Agent name recycling (PRLT-1097)', () => {
    it('recycles a completed agent name for new ephemeral agent', () => {
      setupFreshWorkspace()
      const first = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(first).to.not.be.null
      markAgentCompleted(testDir, 'bold-bezos')

      // Should recycle the name
      const second = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(second).to.not.be.null
      expect(second!.status).to.equal('active')
      expect(second!.cleaned_at).to.be.null
    })

    it('recycles a dead agent name for new ephemeral agent', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      markAgentDead(testDir, 'bold-bezos')

      const recycled = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(recycled).to.not.be.null
      expect(recycled!.status).to.equal('active')
    })

    it('recycles a cleaned agent name for new ephemeral agent', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      markAgentCleaned(testDir, 'bold-bezos')

      const recycled = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(recycled).to.not.be.null
      expect(recycled!.status).to.equal('active')
    })

    it('blocks name reuse for active agents', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      // Agent is active — name should be blocked
      const duplicate = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(duplicate).to.be.null
    })

    it('blocks name reuse for running agents', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      markAgentRunning(testDir, 'bold-bezos')
      const duplicate = tryAddEphemeralAgentToDatabase(testDir, 'bold-bezos', 'bezos')
      expect(duplicate).to.be.null
    })

    it('excludes recycled names from getEphemeralAgentNames', () => {
      setupFreshWorkspace()
      tryAddEphemeralAgentToDatabase(testDir, 'a1', 'base')
      tryAddEphemeralAgentToDatabase(testDir, 'a2', 'base')
      markAgentCompleted(testDir, 'a1')
      const names = getEphemeralAgentNames(testDir)
      expect(names.size).to.equal(1)
      expect(names.has('a2')).to.be.true
      expect(names.has('a1')).to.be.false
    })
  })

  describe('Agent record pruning (PRLT-1097)', () => {
    it('prunes old completed agents', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['old-agent'])
      markAgentCompleted(testDir, 'old-agent')

      // Manually backdate created_at to 60 days ago
      const db = openWorkspaceDatabase(testDir)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 60)
      db.prepare('UPDATE agents SET created_at = ? WHERE name = ?').run(oldDate.toISOString(), 'old-agent')
      db.close()

      const result = pruneAgentRecords(testDir, { olderThanDays: 30 })
      expect(result.dryRun).to.be.false
      expect(result.pruned).to.have.length(1)
      expect(result.pruned[0].name).to.equal('old-agent')

      // Agent should be gone from database
      const agent = getAgent(testDir, 'old-agent')
      expect(agent).to.be.null
    })

    it('does not prune recent agents', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['new-agent'])
      markAgentCompleted(testDir, 'new-agent')

      const result = pruneAgentRecords(testDir, { olderThanDays: 30 })
      expect(result.pruned).to.have.length(0)

      // Agent should still exist
      const agent = getAgent(testDir, 'new-agent')
      expect(agent).to.not.be.null
    })

    it('does not prune active/running agents', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['active-agent', 'running-agent'])
      markAgentRunning(testDir, 'running-agent')

      // Backdate both
      const db = openWorkspaceDatabase(testDir)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 60)
      db.prepare('UPDATE agents SET created_at = ?').run(oldDate.toISOString())
      db.close()

      const result = pruneAgentRecords(testDir, { olderThanDays: 30 })
      expect(result.pruned).to.have.length(0)
    })

    it('supports dry-run mode', () => {
      setupFreshWorkspace()
      addAgentsToDatabase(testDir, ['old-agent'])
      markAgentCompleted(testDir, 'old-agent')

      const db = openWorkspaceDatabase(testDir)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 60)
      db.prepare('UPDATE agents SET created_at = ? WHERE name = ?').run(oldDate.toISOString(), 'old-agent')
      db.close()

      const result = pruneAgentRecords(testDir, { olderThanDays: 30, dryRun: true })
      expect(result.dryRun).to.be.true
      expect(result.pruned).to.have.length(1)

      // Agent should NOT be deleted in dry-run mode
      const agent = getAgent(testDir, 'old-agent')
      expect(agent).to.not.be.null
    })

    it('RECYCLABLE_STATUSES contains completed, dead, cleaned', () => {
      expect(RECYCLABLE_STATUSES).to.include('completed')
      expect(RECYCLABLE_STATUSES).to.include('dead')
      expect(RECYCLABLE_STATUSES).to.include('cleaned')
      expect(RECYCLABLE_STATUSES).to.not.include('active')
      expect(RECYCLABLE_STATUSES).to.not.include('running')
    })

    it('ACTIVE_STATUSES contains active and running', () => {
      expect(ACTIVE_STATUSES).to.include('active')
      expect(ACTIVE_STATUSES).to.include('running')
      expect(ACTIVE_STATUSES).to.not.include('completed')
    })
  })
})
