import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

/**
 * Regression tests for TKT-006: session poke lookup unification
 *
 * The bug: `prlt session poke agent-name` returned SESSION_NOT_FOUND even when
 * `prlt session list` showed the agent running. Root cause: session poke only
 * checked the workspace DB (ExecutionStorage), while session list also checked
 * the machine DB (MachineDB). Ticketless work started via `prlt work run` is
 * tracked only in machine.db, so poke couldn't find those sessions.
 *
 * The fix: session poke now checks both workspace DB and machine DB, matching
 * the same lookup strategy used by session list.
 *
 * These tests verify the lookup logic that both commands share:
 * 1. Workspace DB lookup by agent name and ticket ID
 * 2. Machine DB lookup as fallback (simulated with a second ExecutionStorage)
 * 3. Workspace DB match takes priority over machine DB
 */
describe('@smoke Session Poke Lookup (TKT-006)', () => {
  // We simulate the two-stage lookup from session poke using two ExecutionStorage
  // instances (workspace and "machine") to verify the fallback behavior.
  // The real MachineDB has a different schema but the same lookup pattern:
  // find by agentName or ticketId in active executions.

  const AGENT_WORK_SCHEMA = `
    CREATE TABLE IF NOT EXISTS ${PMO_TABLES.agent_work} (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      environment TEXT DEFAULT 'host',
      display_mode TEXT DEFAULT 'terminal',
      permission_mode TEXT DEFAULT 'safe',
      cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
      status TEXT NOT NULL,
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      external_source TEXT,
      external_key TEXT,
      external_id TEXT,
      external_url TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      exit_code INTEGER,
      error_message TEXT,
      last_heartbeat TEXT,
      lifecycle_state TEXT,
      retries INTEGER
    )
  `

  describe('workspace DB lookup', () => {
    let fastDb: FastTestDb
    let db: Database.Database
    let storage: ExecutionStorage

    before(() => {
      fastDb = createFastTestDb((db) => { db.exec(AGENT_WORK_SCHEMA) })
      db = fastDb.db
    })

    beforeEach(() => {
      fastDb.savepoint()
      storage = new ExecutionStorage(db)
    })

    afterEach(() => { fastDb.rollback() })
    after(() => { fastDb.close() })

    it('finds running execution by agent name', () => {
      storage.createExecution({
        ticketId: 'TKT-200',
        agentName: 'altman',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'TKT-200-Implement-altman',
      })
      storage.updateStatus(storage.listExecutions({ status: 'starting' })[0].id, 'running')

      const running = storage.listExecutions({ status: 'running' })
      const match = running.find(e => e.agentName === 'altman')
      expect(match).to.not.be.undefined
      expect(match!.agentName).to.equal('altman')
      expect(match!.ticketId).to.equal('TKT-200')
    })

    it('finds running execution by ticket ID', () => {
      storage.createExecution({
        ticketId: 'TKT-201',
        agentName: 'brockman',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'TKT-201-Implement-brockman',
      })
      storage.updateStatus(storage.listExecutions({ status: 'starting' })[0].id, 'running')

      const running = storage.listExecutions({ status: 'running' })
      const match = running.find(e => e.ticketId === 'TKT-201')
      expect(match).to.not.be.undefined
      expect(match!.agentName).to.equal('brockman')
    })

    it('does not find stopped executions in active list', () => {
      storage.createExecution({
        ticketId: 'TKT-202',
        agentName: 'stopped-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      const exec = storage.listExecutions({ status: 'starting' })[0]
      storage.updateStatus(exec.id, 'stopped')

      const running = storage.listExecutions({ status: 'running' })
      const starting = storage.listExecutions({ status: 'starting' })
      const active = [...running, ...starting]
      const match = active.find(e => e.agentName === 'stopped-agent')
      expect(match).to.be.undefined
    })
  })

  describe('two-stage fallback (workspace then machine DB)', () => {
    let workspaceFastDb: FastTestDb
    let machineFastDb: FastTestDb
    let workspaceDb: Database.Database
    let machineDb: Database.Database
    let workspaceStorage: ExecutionStorage
    let machineStorage: ExecutionStorage

    before(() => {
      workspaceFastDb = createFastTestDb((db) => { db.exec(AGENT_WORK_SCHEMA) })
      workspaceDb = workspaceFastDb.db
      machineFastDb = createFastTestDb((db) => { db.exec(AGENT_WORK_SCHEMA) })
      machineDb = machineFastDb.db
    })

    beforeEach(() => {
      workspaceFastDb.savepoint()
      machineFastDb.savepoint()
      workspaceStorage = new ExecutionStorage(workspaceDb)
      machineStorage = new ExecutionStorage(machineDb)
    })

    afterEach(() => {
      workspaceFastDb.rollback()
      machineFastDb.rollback()
    })

    after(() => {
      workspaceFastDb.close()
      machineFastDb.close()
    })

    it('falls back to machine DB when workspace DB has no match (TKT-006 regression)', () => {
      // Agent only exists in machine DB (ticketless work via `prlt work run`)
      machineStorage.createExecution({
        ticketId: 'MRUN-ABC12345',
        agentName: 'ticketless-worker',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'ticketless-session',
      })
      machineStorage.updateStatus(machineStorage.listExecutions({ status: 'starting' })[0].id, 'running')

      // Simulate the two-stage lookup from session poke
      const identifier = 'ticketless-worker'

      // Stage 1: workspace DB (empty — no match)
      const wsRunning = workspaceStorage.listExecutions({ status: 'running' })
      const wsStarting = workspaceStorage.listExecutions({ status: 'starting' })
      const wsMatch = [...wsRunning, ...wsStarting].find(e =>
        e.agentName === identifier || e.ticketId === identifier,
      )
      expect(wsMatch).to.be.undefined

      // Stage 2: machine DB (has the execution — should find it)
      const mRunning = machineStorage.listExecutions({ status: 'running' })
      const mStarting = machineStorage.listExecutions({ status: 'starting' })
      const mMatch = [...mRunning, ...mStarting].find(e =>
        e.agentName === identifier || e.ticketId === identifier,
      )
      expect(mMatch).to.not.be.undefined
      expect(mMatch!.agentName).to.equal('ticketless-worker')
      expect(mMatch!.sessionId).to.equal('ticketless-session')
    })

    it('prefers workspace DB match over machine DB match', () => {
      // Same agent name in both DBs with different ticket IDs
      workspaceStorage.createExecution({
        ticketId: 'TKT-300',
        agentName: 'dual-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'workspace-session',
      })
      workspaceStorage.updateStatus(workspaceStorage.listExecutions({ status: 'starting' })[0].id, 'running')

      machineStorage.createExecution({
        ticketId: 'MRUN-OLDER',
        agentName: 'dual-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'machine-session',
      })
      machineStorage.updateStatus(machineStorage.listExecutions({ status: 'starting' })[0].id, 'running')

      // Simulate two-stage lookup — workspace match should win
      const identifier = 'dual-agent'

      const wsRunning = workspaceStorage.listExecutions({ status: 'running' })
      let match = wsRunning.find(e => e.agentName === identifier)

      // Only check machine DB if workspace had no match
      if (!match) {
        const mRunning = machineStorage.listExecutions({ status: 'running' })
        match = mRunning.find(e => e.agentName === identifier)
      }

      expect(match).to.not.be.undefined
      expect(match!.ticketId).to.equal('TKT-300')
      expect(match!.sessionId).to.equal('workspace-session')
    })

    it('finds machine DB execution by ticket ID', () => {
      machineStorage.createExecution({
        ticketId: 'MRUN-XYZ99',
        agentName: 'id-lookup-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        sessionId: 'id-lookup-session',
      })
      machineStorage.updateStatus(machineStorage.listExecutions({ status: 'starting' })[0].id, 'running')

      const identifier = 'MRUN-XYZ99'

      // Stage 1: workspace (empty)
      const wsActive = [
        ...workspaceStorage.listExecutions({ status: 'running' }),
        ...workspaceStorage.listExecutions({ status: 'starting' }),
      ]
      expect(wsActive.find(e => e.agentName === identifier || e.ticketId === identifier)).to.be.undefined

      // Stage 2: machine DB
      const mActive = [
        ...machineStorage.listExecutions({ status: 'running' }),
        ...machineStorage.listExecutions({ status: 'starting' }),
      ]
      const mMatch = mActive.find(e => e.agentName === identifier || e.ticketId === identifier)
      expect(mMatch).to.not.be.undefined
      expect(mMatch!.agentName).to.equal('id-lookup-agent')
    })
  })
})
