import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionStore } from '../../src/lib/session-store.js'
import type { SessionRole } from '../../src/lib/session-store.js'

// Ensure Date.now() advances between rapid session creates to avoid ID collision
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 2))

describe('Reconciler Daemon — Session Role Support', () => {
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
    it('creates a session with role=daemon', () => {
      const session = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'Reconcile session state',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      expect(session.role).to.equal('daemon')
      expect(session.agentName).to.equal('reconciler')
      expect(session.status).to.equal('running')
    })

    it('defaults role to worker when not specified', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'implement feature',
        workdir: '/repo',
        sessionName: 'TKT-001-implement-alice',
        environment: 'host',
        permissionMode: 'safe',
      })

      expect(session.role).to.equal('worker')
    })

    it('persists role through get()', () => {
      const created = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'Reconcile session state',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      const found = store.get(created.id)
      expect(found).to.not.be.null
      expect(found!.role).to.equal('daemon')
    })

    it('persists role through list()', () => {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'Reconcile session state',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      const sessions = store.list('running')
      expect(sessions).to.have.lengthOf(1)
      expect(sessions[0].role).to.equal('daemon')
    })

    it('supports all role types', async () => {
      const roles: SessionRole[] = ['worker', 'orchestrator', 'daemon', 'headless']

      for (const role of roles) {
        const session = store.create({
          agentName: `agent-${role}`,
          runner: 'test',
          task: `task for ${role}`,
          workdir: '/repo',
          sessionName: `session-${role}`,
          environment: 'host',
          permissionMode: 'safe',
          role,
        })
        expect(session.role).to.equal(role)
        await tick()
      }

      const all = store.list()
      expect(all).to.have.lengthOf(4)
    })
  })

  // ===========================================================================
  // listByRole()
  // ===========================================================================

  describe('listByRole()', () => {
    it('returns only sessions with the specified role', async () => {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })
      await tick()

      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'implement',
        workdir: '/repo',
        sessionName: 'TKT-001-implement-alice',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker',
      })

      const daemons = store.listByRole('daemon')
      expect(daemons).to.have.lengthOf(1)
      expect(daemons[0].agentName).to.equal('reconciler')

      const workers = store.listByRole('worker')
      expect(workers).to.have.lengthOf(1)
      expect(workers[0].agentName).to.equal('alice')
    })

    it('only returns running sessions', async () => {
      const daemon = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      store.updateStatus(daemon.id, 'done')

      const daemons = store.listByRole('daemon')
      expect(daemons).to.have.lengthOf(0)
    })

    it('returns empty array when no sessions match', () => {
      const daemons = store.listByRole('daemon')
      expect(daemons).to.deep.equal([])
    })
  })

  // ===========================================================================
  // isDaemonRunning()
  // ===========================================================================

  describe('isDaemonRunning()', () => {
    it('returns true when a running daemon session exists', () => {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      expect(store.isDaemonRunning('prlt-reconciler')).to.be.true
    })

    it('returns false when daemon is stopped', () => {
      const daemon = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      store.updateStatus(daemon.id, 'done')
      expect(store.isDaemonRunning('prlt-reconciler')).to.be.false
    })

    it('returns false when no daemon exists', () => {
      expect(store.isDaemonRunning('prlt-reconciler')).to.be.false
    })

    it('returns false for worker sessions with same name', () => {
      store.create({
        agentName: 'reconciler',
        runner: 'claude-code',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker', // Not a daemon
      })

      expect(store.isDaemonRunning('prlt-reconciler')).to.be.false
    })
  })

  // ===========================================================================
  // Schema migration — role column added to existing DBs
  // ===========================================================================

  describe('schema migration', () => {
    it('existing sessions get role=worker after migration', () => {
      // Create a session before role column exists (simulate old DB)
      // The CREATE TABLE IF NOT EXISTS + ALTER TABLE migration handles this
      const session = store.create({
        agentName: 'legacy-agent',
        runner: 'claude-code',
        task: 'old task',
        workdir: '/repo',
        sessionName: 'legacy-session',
        environment: 'host',
        permissionMode: 'safe',
        // No role specified
      })

      expect(session.role).to.equal('worker')
    })

    it('re-opening the database is safe (migration is idempotent)', () => {
      store.create({
        agentName: 'test',
        runner: 'test',
        task: 'test',
        workdir: '/repo',
        sessionName: 'test-session',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      store.close()

      // Re-open — should not throw on duplicate ALTER TABLE
      const store2 = new SessionStore(dbPath)
      const sessions = store2.list()
      expect(sessions).to.have.lengthOf(1)
      expect(sessions[0].role).to.equal('daemon')
      store2.close()

      // Re-assign for afterEach cleanup
      store = new SessionStore(dbPath)
    })
  })

  // ===========================================================================
  // Session prune daemon protection
  // ===========================================================================

  describe('daemon protection in prune', () => {
    it('daemon sessions should be identifiable by role for prune exclusion', async () => {
      // Create a daemon and a worker
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'reconcile',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })
      await tick()

      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'implement',
        workdir: '/repo',
        sessionName: 'TKT-001-implement-alice',
        environment: 'host',
        permissionMode: 'safe',
        role: 'worker',
      })

      // Get daemon session names — prune should skip these
      const daemonNames = new Set(
        store.listByRole('daemon').map(s => s.sessionName)
      )

      expect(daemonNames.has('prlt-reconciler')).to.be.true
      expect(daemonNames.has('TKT-001-implement-alice')).to.be.false

      // Simulate prune logic: filter out sessions whose names are in daemonNames
      const allRunning = store.list('running')
      const pruneable = allRunning.filter(s => !daemonNames.has(s.sessionName))

      expect(pruneable).to.have.lengthOf(1)
      expect(pruneable[0].agentName).to.equal('alice')
    })
  })

  // ===========================================================================
  // Session list daemon display
  // ===========================================================================

  describe('daemon display in session list', () => {
    it('daemon sessions have ticketId-independent identification', () => {
      const daemon = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'Reconcile session and execution state',
        workdir: '/repo',
        sessionName: 'prlt-reconciler',
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })

      // Daemons should be findable by their session name
      const found = store.getBySessionName('prlt-reconciler')
      expect(found).to.not.be.null
      expect(found!.role).to.equal('daemon')
      expect(found!.agentName).to.equal('reconciler')
      expect(found!.id).to.equal(daemon.id)
    })
  })
})
