import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionStore } from '../../src/lib/session-store.js'
import { openDriver } from '../../src/lib/database/driver.js'
import { parseSessionName } from '../../src/lib/execution/session-utils.js'

// Ensure Date.now() advances between rapid session creates to avoid ID collision
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 2))

describe('Daemon Sessions (PRLT-1287)', () => {
  let store: SessionStore
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-daemon-test-')))
    dbPath = path.join(tmpDir, 'sessions.db')
    store = new SessionStore(dbPath)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // Daemon role in SessionStore
  // ===========================================================================

  describe('daemon role', () => {
    it('creates a session with role=daemon and daemonType', () => {
      const session = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'session-reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      expect(session.role).to.equal('daemon')
      expect(session.daemonType).to.equal('reconciler')
      expect(session.status).to.equal('running')
    })

    it('defaults role to worker when not specified', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'implement feature',
        workdir: '/repo',
        sessionName: 'TKT-001-Implement-alice',
        environment: 'host',
        permissionMode: 'safe',
      })

      expect(session.role).to.equal('worker')
      expect(session.daemonType).to.be.undefined
    })

    it('persists role and daemonType across reads', () => {
      const created = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'session-reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      const retrieved = store.get(created.id)
      expect(retrieved).to.not.be.null
      expect(retrieved!.role).to.equal('daemon')
      expect(retrieved!.daemonType).to.equal('reconciler')
    })
  })

  // ===========================================================================
  // listByRole()
  // ===========================================================================

  describe('listByRole()', () => {
    it('returns only sessions matching the given role', async () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'work',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker',
      })

      await tick()
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      const daemons = store.listByRole('daemon')
      expect(daemons).to.have.lengthOf(1)
      expect(daemons[0].agentName).to.equal('reconciler')
      expect(daemons[0].role).to.equal('daemon')

      const workers = store.listByRole('worker')
      expect(workers).to.have.lengthOf(1)
      expect(workers[0].agentName).to.equal('alice')
    })

    it('filters by role and status', async () => {
      const daemon1 = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      await tick()
      store.create({
        agentName: 'rebase-coordinator',
        runner: 'daemon',
        task: 'rebase',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-rebase',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'rebase-coordinator',
      })

      // Mark first daemon as done
      store.updateStatus(daemon1.id, 'done')

      const runningDaemons = store.listByRole('daemon', 'running')
      expect(runningDaemons).to.have.lengthOf(1)
      expect(runningDaemons[0].agentName).to.equal('rebase-coordinator')
    })

    it('returns empty array when no sessions match role', () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'work',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker',
      })

      const daemons = store.listByRole('daemon')
      expect(daemons).to.deep.equal([])
    })
  })

  // ===========================================================================
  // getRunningDaemon()
  // ===========================================================================

  describe('getRunningDaemon()', () => {
    it('returns the running daemon for the given type', () => {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      const daemon = store.getRunningDaemon('reconciler')
      expect(daemon).to.not.be.null
      expect(daemon!.agentName).to.equal('reconciler')
      expect(daemon!.daemonType).to.equal('reconciler')
      expect(daemon!.status).to.equal('running')
    })

    it('returns null when daemon is not running', () => {
      const created = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })
      store.updateStatus(created.id, 'done')

      const daemon = store.getRunningDaemon('reconciler')
      expect(daemon).to.be.null
    })

    it('returns null when daemon type does not exist', () => {
      const daemon = store.getRunningDaemon('nonexistent')
      expect(daemon).to.be.null
    })

    it('returns most recent running daemon when multiple exist', async () => {
      store.create({
        agentName: 'reconciler-old',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler-old',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      await tick()
      store.create({
        agentName: 'reconciler-new',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler-new',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      const daemon = store.getRunningDaemon('reconciler')
      expect(daemon).to.not.be.null
      expect(daemon!.agentName).to.equal('reconciler-new')
    })
  })

  // ===========================================================================
  // Schema migration
  // ===========================================================================

  describe('schema migration', () => {
    it('adds role and daemon_type columns to existing database', () => {
      // Create a store with the old schema (no role/daemon_type columns)
      store.close()

      // Open a fresh DB, manually create the old schema without role/daemon_type
      const rawDb = openDriver(dbPath, { foreignKeys: false })
      rawDb.exec(`
        DROP TABLE IF EXISTS sessions;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          agent_name TEXT NOT NULL,
          runner TEXT NOT NULL,
          task TEXT NOT NULL,
          workdir TEXT NOT NULL,
          session_name TEXT NOT NULL,
          environment TEXT NOT NULL DEFAULT 'host',
          permission_mode TEXT NOT NULL DEFAULT 'safe',
          status TEXT NOT NULL DEFAULT 'running',
          started_at INTEGER NOT NULL,
          ended_at INTEGER
        )
      `)
      // Insert a row with the old schema
      rawDb.prepare(`
        INSERT INTO sessions (id, agent_name, runner, task, workdir, session_name, environment, permission_mode, status, started_at)
        VALUES ('SES-OLD', 'alice', 'claude-code', 'test', '/repo', 'sess-1', 'host', 'safe', 'running', ?)
      `).run(Date.now())
      rawDb.close()

      // Re-open with SessionStore — migration should add the columns
      store = new SessionStore(dbPath)

      // Verify the old row is readable with defaults
      const old = store.get('SES-OLD')
      expect(old).to.not.be.null
      expect(old!.role).to.equal('worker')  // Default value
      expect(old!.daemonType).to.be.undefined

      // Verify we can create daemon sessions now
      const daemon = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })
      expect(daemon.role).to.equal('daemon')
      expect(daemon.daemonType).to.equal('reconciler')
    })
  })

  // ===========================================================================
  // prlt session prune does NOT kill daemons
  // ===========================================================================

  describe('prune protection', () => {
    it('daemon sessions are excluded from orphan detection by parseSessionName', () => {
      // The daemon session name format (prlt-daemon-*) does NOT match
      // the standard prlt session name format (TKT-xxx-action-agent),
      // so parseSessionName() returns null, preventing prune from killing them.
      const result = parseSessionName('prlt-daemon-reconciler')
      expect(result).to.be.null  // Not parseable → won't be treated as orphan
    })

    it('daemon sessions in SessionStore are found by listByRole', async () => {
      // Create a daemon and a worker
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      await tick()
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'work',
        workdir: '/repo',
        sessionName: 'TKT-001-Implement-alice',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker',
      })

      // listByRole('daemon') returns only daemons — prune checks this
      const daemons = store.listByRole('daemon', 'running')
      expect(daemons).to.have.lengthOf(1)
      expect(daemons[0].sessionName).to.equal('prlt-daemon-reconciler')
    })
  })

  // ===========================================================================
  // session list shows daemon with correct role
  // ===========================================================================

  describe('session list integration', () => {
    it('daemon sessions show up with role=daemon in listing', () => {
      const daemon = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'session-reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      // Verify it shows up in list
      const running = store.list('running')
      const daemonSession = running.find(s => s.id === daemon.id)
      expect(daemonSession).to.not.be.undefined
      expect(daemonSession!.role).to.equal('daemon')
      expect(daemonSession!.daemonType).to.equal('reconciler')
    })

    it('multiple daemon types can coexist', async () => {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconciliation',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      await tick()
      store.create({
        agentName: 'rebase-coordinator',
        runner: 'daemon',
        task: 'rebase coordination',
        workdir: '/workspace',
        sessionName: 'prlt-daemon-rebase',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'rebase-coordinator',
      })

      const daemons = store.listByRole('daemon', 'running')
      expect(daemons).to.have.lengthOf(2)

      const reconciler = store.getRunningDaemon('reconciler')
      expect(reconciler).to.not.be.null
      expect(reconciler!.agentName).to.equal('reconciler')

      const rebase = store.getRunningDaemon('rebase-coordinator')
      expect(rebase).to.not.be.null
      expect(rebase!.agentName).to.equal('rebase-coordinator')
    })
  })
})
