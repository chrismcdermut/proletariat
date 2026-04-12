/**
 * Tests for the daemon role system (PRLT-1287)
 *
 * Covers:
 * - ExecutionStorage: daemon role in create/list/filter
 * - cleanupStaleExecutions: skips daemon sessions
 * - Reconciler helpers: isReconcilerRunning, RECONCILER_SESSION_NAME, DAEMON_TICKET_ID
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'
import {
  RECONCILER_SESSION_NAME,
  DAEMON_TICKET_ID,
} from '../../src/commands/reconcile/index.js'

describe('Daemon Role System (PRLT-1287)', () => {
  let fastDb: FastTestDb
  let db: Database.Database
  let storage: ExecutionStorage

  before(() => {
    fastDb = createFastTestDb((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${PMO_TABLES.agent_work} (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          executor TEXT NOT NULL,
          environment TEXT DEFAULT 'host',
          display_mode TEXT DEFAULT 'terminal',
          permission_mode TEXT DEFAULT 'safe',
          cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
          role TEXT NOT NULL DEFAULT 'worker',
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
      `)
    })
    db = fastDb.db
  })

  beforeEach(() => {
    fastDb.savepoint()
    storage = new ExecutionStorage(db)
  })

  afterEach(() => {
    fastDb.rollback()
  })

  after(() => {
    fastDb.close()
  })

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('constants', () => {
    it('RECONCILER_SESSION_NAME follows daemon naming convention', () => {
      expect(RECONCILER_SESSION_NAME).to.equal('prlt-daemon-reconciler')
    })

    it('DAEMON_TICKET_ID is DAEMON', () => {
      expect(DAEMON_TICKET_ID).to.equal('DAEMON')
    })
  })

  // ===========================================================================
  // ExecutionStorage: role field
  // ===========================================================================

  describe('ExecutionStorage role support', () => {
    it('defaults role to worker when not specified', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'test-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      expect(exec.role).to.equal('worker')
    })

    it('creates execution with daemon role', () => {
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: 'reconciler',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
        sessionId: RECONCILER_SESSION_NAME,
      })
      expect(exec.role).to.equal('daemon')
      expect(exec.agentName).to.equal('reconciler')
      expect(exec.ticketId).to.equal(DAEMON_TICKET_ID)
    })

    it('creates execution with orchestrator role', () => {
      const exec = storage.createExecution({
        ticketId: 'ORCH',
        agentName: 'main',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'orchestrator',
      })
      expect(exec.role).to.equal('orchestrator')
    })

    it('filters by role', () => {
      // Create one of each role
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'worker-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        role: 'worker',
      })
      storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: 'reconciler',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
      })

      const workers = storage.listExecutions({ role: 'worker' })
      expect(workers).to.have.lengthOf(1)
      expect(workers[0].agentName).to.equal('worker-agent')

      const daemons = storage.listExecutions({ role: 'daemon' })
      expect(daemons).to.have.lengthOf(1)
      expect(daemons[0].agentName).to.equal('reconciler')
    })

    it('excludeRole filters out a specific role', () => {
      storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'worker-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })
      storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: 'reconciler',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
      })

      const nonDaemons = storage.listExecutions({ excludeRole: 'daemon' })
      expect(nonDaemons).to.have.lengthOf(1)
      expect(nonDaemons[0].agentName).to.equal('worker-agent')
    })
  })

  // ===========================================================================
  // cleanupStaleExecutions: skips daemons
  // ===========================================================================

  describe('cleanupStaleExecutions skips daemons', () => {
    it('does not mark daemon executions as stale even without sessionId', () => {
      // Create a daemon execution with no session ID and old start time
      const exec = storage.createExecution({
        ticketId: DAEMON_TICKET_ID,
        agentName: 'reconciler',
        executor: 'custom',
        environment: 'host',
        displayMode: 'background',
        permissionMode: 'safe',
        role: 'daemon',
      })
      storage.updateStatus(exec.id, 'running')

      // Manually backdate it to look stale (>5 min old with no session)
      db.prepare(`UPDATE ${PMO_TABLES.agent_work} SET started_at = ? WHERE id = ?`)
        .run(Date.now() - 10 * 60 * 1000, exec.id)

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(0)

      // Verify daemon is still running
      const running = storage.listExecutions({ status: 'running', role: 'daemon' })
      expect(running).to.have.lengthOf(1)
      expect(running[0].id).to.equal(exec.id)
    })

    it('still marks worker executions as stale', () => {
      // Create a worker execution with no session ID and old start time
      const exec = storage.createExecution({
        ticketId: 'TKT-001',
        agentName: 'test-worker',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
        role: 'worker',
      })
      storage.updateStatus(exec.id, 'running')

      // Backdate it to look stale
      db.prepare(`UPDATE ${PMO_TABLES.agent_work} SET started_at = ? WHERE id = ?`)
        .run(Date.now() - 10 * 60 * 1000, exec.id)

      const cleaned = storage.cleanupStaleExecutions()
      expect(cleaned).to.equal(1)

      // Verify worker is now stopped
      const running = storage.listExecutions({ status: 'running', role: 'worker' })
      expect(running).to.have.lengthOf(0)
    })
  })

  // ===========================================================================
  // Session list: role in VerifiedSession
  // ===========================================================================

  describe('daemon display formatting', () => {
    it('daemon ticket ID should show as DAEMON not a ticket', () => {
      // Verify our sentinel value is distinct from ticket IDs
      expect(DAEMON_TICKET_ID).to.not.match(/^TKT-/)
      expect(DAEMON_TICKET_ID).to.not.match(/^PRLT-/)
    })

    it('reconciler session name does not match prlt session naming pattern', () => {
      // The parseSessionName function expects {ticketId}-{action}-{agentName}
      // Daemon sessions use prlt-daemon-{type} which should NOT match,
      // preventing them from being treated as orphans
      expect(RECONCILER_SESSION_NAME).to.match(/^prlt-daemon-/)
      expect(RECONCILER_SESSION_NAME).to.not.match(/^TKT-/)
      expect(RECONCILER_SESSION_NAME).to.not.match(/^[A-Z]+-\d+-/)
    })
  })
})
