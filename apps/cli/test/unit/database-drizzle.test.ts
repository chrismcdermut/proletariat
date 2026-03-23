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
  markAgentCleaned,
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

  describe('PMO bootstrap operations', () => {
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
})
