import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionStore } from '../../src/lib/session-store.js'

// Ensure Date.now() advances between rapid session creates to avoid ID collision
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 2))

describe('SessionStore', () => {
  let store: SessionStore
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-session-test-')))
    dbPath = path.join(tmpDir, 'sessions.db')
    store = new SessionStore(dbPath)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // create()
  // ===========================================================================

  describe('create()', () => {
    it('creates a session with all required fields', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'implement feature',
        workdir: '/repo/agent-alice',
        sessionName: 'prlt-alice-TKT-001',
        environment: 'host',
        permissionMode: 'safe',
      })

      expect(session.id).to.match(/^SES-/)
      expect(session.agentName).to.equal('alice')
      expect(session.runner).to.equal('claude-code')
      expect(session.task).to.equal('implement feature')
      expect(session.workdir).to.equal('/repo/agent-alice')
      expect(session.sessionName).to.equal('prlt-alice-TKT-001')
      expect(session.environment).to.equal('host')
      expect(session.permissionMode).to.equal('safe')
      expect(session.status).to.equal('running')
      expect(session.startedAt).to.be.instanceOf(Date)
      expect(session.endedAt).to.be.undefined
    })

    it('generates unique session IDs', async () => {
      const s1 = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'task 1',
        workdir: '/repo',
        sessionName: 'session-1',
        environment: 'host',
        permissionMode: 'safe',
      })
      await tick()
      const s2 = store.create({
        agentName: 'bob',
        runner: 'claude-code',
        task: 'task 2',
        workdir: '/repo',
        sessionName: 'session-2',
        environment: 'host',
        permissionMode: 'safe',
      })

      expect(s1.id).to.not.equal(s2.id)
    })

    it('supports docker environment and danger mode', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'codex',
        task: 'dangerous task',
        workdir: '/repo',
        sessionName: 'docker-session',
        environment: 'docker',
        permissionMode: 'danger',
      })

      expect(session.environment).to.equal('docker')
      expect(session.permissionMode).to.equal('danger')
    })
  })

  // ===========================================================================
  // get()
  // ===========================================================================

  describe('get()', () => {
    it('retrieves a session by exact ID', () => {
      const created = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.get(created.id)
      expect(found).to.not.be.null
      expect(found!.id).to.equal(created.id)
      expect(found!.agentName).to.equal('alice')
    })

    it('retrieves a session by agent name', () => {
      store.create({
        agentName: 'unique-agent',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.get('unique-agent')
      expect(found).to.not.be.null
      expect(found!.agentName).to.equal('unique-agent')
    })

    it('returns null for non-existent session', () => {
      const found = store.get('does-not-exist')
      expect(found).to.be.null
    })

    it('returns most recent session when agent name matches multiple', async () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'first task',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      await tick()
      const s2 = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'second task',
        workdir: '/repo',
        sessionName: 'sess-2',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.get('alice')
      expect(found).to.not.be.null
      expect(found!.id).to.equal(s2.id)
    })
  })

  // ===========================================================================
  // getBySessionName()
  // ===========================================================================

  describe('getBySessionName()', () => {
    it('retrieves a session by tmux session name', () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'prlt-alice-TKT-001',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.getBySessionName('prlt-alice-TKT-001')
      expect(found).to.not.be.null
      expect(found!.agentName).to.equal('alice')
      expect(found!.sessionName).to.equal('prlt-alice-TKT-001')
    })

    it('returns null for non-existent session name', () => {
      const found = store.getBySessionName('non-existent-session')
      expect(found).to.be.null
    })
  })

  // ===========================================================================
  // list()
  // ===========================================================================

  describe('list()', () => {
    it('lists all sessions when no filter is provided', async () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'task 1',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })
      await tick()
      store.create({
        agentName: 'bob',
        runner: 'claude-code',
        task: 'task 2',
        workdir: '/repo',
        sessionName: 'sess-2',
        environment: 'host',
        permissionMode: 'safe',
      })

      const all = store.list()
      expect(all).to.have.lengthOf(2)
    })

    it('filters sessions by status', async () => {
      const s1 = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'task 1',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })
      await tick()
      store.create({
        agentName: 'bob',
        runner: 'claude-code',
        task: 'task 2',
        workdir: '/repo',
        sessionName: 'sess-2',
        environment: 'host',
        permissionMode: 'safe',
      })
      store.updateStatus(s1.id, 'done')

      const running = store.list('running')
      expect(running).to.have.lengthOf(1)
      expect(running[0].agentName).to.equal('bob')

      const done = store.list('done')
      expect(done).to.have.lengthOf(1)
      expect(done[0].agentName).to.equal('alice')
    })

    it('returns empty array when no sessions exist', () => {
      const all = store.list()
      expect(all).to.deep.equal([])
    })

    it('returns sessions in descending order by startedAt', async () => {
      store.create({
        agentName: 'first',
        runner: 'claude-code',
        task: 'task',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })
      await tick()
      store.create({
        agentName: 'second',
        runner: 'claude-code',
        task: 'task',
        workdir: '/repo',
        sessionName: 'sess-2',
        environment: 'host',
        permissionMode: 'safe',
      })

      const all = store.list()
      // Most recent first
      expect(all[0].agentName).to.equal('second')
      expect(all[1].agentName).to.equal('first')
    })
  })

  // ===========================================================================
  // updateStatus()
  // ===========================================================================

  describe('updateStatus()', () => {
    it('updates status to done and sets endedAt', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      store.updateStatus(session.id, 'done')
      const updated = store.get(session.id)
      expect(updated!.status).to.equal('done')
      expect(updated!.endedAt).to.be.instanceOf(Date)
    })

    it('updates status to error and sets endedAt', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      store.updateStatus(session.id, 'error')
      const updated = store.get(session.id)
      expect(updated!.status).to.equal('error')
      expect(updated!.endedAt).to.be.instanceOf(Date)
    })

    it('updates status to stopped and sets endedAt', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      store.updateStatus(session.id, 'stopped')
      const updated = store.get(session.id)
      expect(updated!.status).to.equal('stopped')
      expect(updated!.endedAt).to.be.instanceOf(Date)
    })

    it('does not overwrite endedAt on subsequent status updates', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'sess-1',
        environment: 'host',
        permissionMode: 'safe',
      })

      store.updateStatus(session.id, 'done')
      const firstUpdate = store.get(session.id)!
      const firstEndedAt = firstUpdate.endedAt!.getTime()

      // Update again — endedAt should be preserved via COALESCE
      store.updateStatus(session.id, 'error')
      const secondUpdate = store.get(session.id)!
      expect(secondUpdate.endedAt!.getTime()).to.equal(firstEndedAt)
    })
  })

  // ===========================================================================
  // resolve()
  // ===========================================================================

  describe('resolve()', () => {
    it('resolves by exact session ID', () => {
      const session = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'prlt-alice-001',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.resolve(session.id)
      expect(found).to.not.be.null
      expect(found!.id).to.equal(session.id)
    })

    it('resolves by partial agent name', () => {
      store.create({
        agentName: 'alice-wonderland',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'prlt-alice-001',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.resolve('wonderland')
      expect(found).to.not.be.null
      expect(found!.agentName).to.equal('alice-wonderland')
    })

    it('resolves by partial session name', () => {
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        sessionName: 'prlt-alice-TKT-099',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.resolve('TKT-099')
      expect(found).to.not.be.null
      expect(found!.sessionName).to.equal('prlt-alice-TKT-099')
    })

    it('prefers running sessions over completed ones', async () => {
      const s1 = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'old task',
        workdir: '/repo',
        sessionName: 'prlt-alice-old',
        environment: 'host',
        permissionMode: 'safe',
      })
      store.updateStatus(s1.id, 'done')

      await tick()
      store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'new task',
        workdir: '/repo',
        sessionName: 'prlt-alice-new',
        environment: 'host',
        permissionMode: 'safe',
      })

      const found = store.resolve('alice')
      expect(found).to.not.be.null
      expect(found!.status).to.equal('running')
    })

    it('falls back to completed sessions when no running match', () => {
      const s1 = store.create({
        agentName: 'alice',
        runner: 'claude-code',
        task: 'finished task',
        workdir: '/repo',
        sessionName: 'prlt-alice-done',
        environment: 'host',
        permissionMode: 'safe',
      })
      store.updateStatus(s1.id, 'done')

      const found = store.resolve('alice')
      expect(found).to.not.be.null
      expect(found!.status).to.equal('done')
    })

    it('returns null when no match is found', () => {
      const found = store.resolve('nonexistent')
      expect(found).to.be.null
    })
  })

  // ===========================================================================
  // Schema idempotency
  // ===========================================================================

  describe('schema', () => {
    it('can open same database file multiple times without error', () => {
      store.close()
      // Re-open same DB — ensureSchema should be idempotent (CREATE TABLE IF NOT EXISTS)
      const store2 = new SessionStore(dbPath)
      const sessions = store2.list()
      expect(sessions).to.be.an('array')
      store2.close()

      // Re-assign for afterEach cleanup
      store = new SessionStore(dbPath)
    })
  })
})
