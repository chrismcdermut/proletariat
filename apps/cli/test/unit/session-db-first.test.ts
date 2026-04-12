import { expect } from 'chai'
import Database from 'better-sqlite3'
import { ExecutionStorage } from '../../src/lib/execution/storage.js'
import { PMO_TABLES } from '../../src/lib/pmo/schema.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'
import {
  isContainerEnvironment,
  parseSessionName,
} from '../../src/lib/execution/session-utils.js'

/**
 * Regression tests for PRLT-1139: DB-first session discovery
 *
 * Verifies that:
 * 1. Docker environment agents are recognized as container-based
 * 2. Both 'devcontainer' and 'docker' environments are handled correctly
 * 3. isContainerEnvironment helper works for all environment types
 * 4. Execution storage handles docker environments in cleanup
 */
describe('@smoke Session DB-First (PRLT-1139)', () => {
  describe('isContainerEnvironment', () => {
    it('returns true for devcontainer environment', () => {
      expect(isContainerEnvironment('devcontainer')).to.be.true
    })

    it('returns true for docker environment', () => {
      expect(isContainerEnvironment('docker')).to.be.true
    })

    it('returns false for host environment', () => {
      expect(isContainerEnvironment('host')).to.be.false
    })

    it('returns false for sandbox environment', () => {
      expect(isContainerEnvironment('sandbox')).to.be.false
    })

    it('returns false for cloud environment', () => {
      expect(isContainerEnvironment('cloud')).to.be.false
    })
  })

  describe('ExecutionStorage with docker environment', () => {
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

    it('creates execution with docker environment', () => {
      const exec = storage.createExecution({
        ticketId: 'TKT-100',
        agentName: 'docker-agent',
        executor: 'claude-code',
        environment: 'docker',
        displayMode: 'background',
        permissionMode: 'danger',
        containerId: 'abc123def456',
        sessionId: 'TKT-100-Implement-docker-agent',
      })

      expect(exec.environment).to.equal('docker')
      expect(exec.containerId).to.equal('abc123def456')
      expect(exec.status).to.equal('starting')
    })

    it('lists docker environment executions alongside devcontainer ones', () => {
      // Create a docker env execution
      storage.createExecution({
        ticketId: 'TKT-100',
        agentName: 'docker-agent',
        executor: 'claude-code',
        environment: 'docker',
        displayMode: 'background',
        permissionMode: 'danger',
        containerId: 'abc123def456',
      })

      // Create a devcontainer env execution
      storage.createExecution({
        ticketId: 'TKT-101',
        agentName: 'devc-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'safe',
        containerId: 'xyz789ghi012',
      })

      // Create a host env execution
      storage.createExecution({
        ticketId: 'TKT-102',
        agentName: 'host-agent',
        executor: 'claude-code',
        environment: 'host',
        displayMode: 'terminal',
        permissionMode: 'safe',
      })

      const starting = storage.listExecutions({ status: 'starting' })
      expect(starting).to.have.length(3)

      const dockerExec = starting.find(e => e.environment === 'docker')
      expect(dockerExec).to.exist
      expect(dockerExec!.containerId).to.equal('abc123def456')

      const devcontainerExec = starting.find(e => e.environment === 'devcontainer')
      expect(devcontainerExec).to.exist
      expect(devcontainerExec!.containerId).to.equal('xyz789ghi012')

      const hostExec = starting.find(e => e.environment === 'host')
      expect(hostExec).to.exist
      expect(hostExec!.containerId).to.be.undefined
    })

    it('recognizes both docker and devcontainer as container environments', () => {
      const dockerExec = storage.createExecution({
        ticketId: 'TKT-200',
        agentName: 'docker-agent',
        executor: 'claude-code',
        environment: 'docker',
        displayMode: 'background',
        permissionMode: 'danger',
        containerId: 'docker123',
      })

      const devcontainerExec = storage.createExecution({
        ticketId: 'TKT-201',
        agentName: 'devc-agent',
        executor: 'claude-code',
        environment: 'devcontainer',
        displayMode: 'terminal',
        permissionMode: 'safe',
        containerId: 'devc123',
      })

      // Both should be recognized as container environments
      expect(isContainerEnvironment(dockerExec.environment)).to.be.true
      expect(isContainerEnvironment(devcontainerExec.environment)).to.be.true
    })
  })

  describe('Orphan session detection', () => {
    it('parseSessionName returns null for non-prlt session names', () => {
      // Random tmux sessions should NOT be parsed as prlt sessions
      expect(parseSessionName('my-random-session')).to.be.null
      expect(parseSessionName('dev-server')).to.be.null
      expect(parseSessionName('0')).to.be.null
    })

    it('parseSessionName returns parsed info for prlt session names', () => {
      const result = parseSessionName('TKT-123-Implement-my-agent')
      expect(result).to.deep.equal({
        ticketId: 'TKT-123',
        action: 'Implement',
        agentName: 'my-agent',
      })
    })

    it('orphan sessions are only those matching prlt pattern but not in DB', () => {
      // This test verifies the concept: sessions discovered from tmux that
      // match the prlt naming convention but have no corresponding DB record
      // are orphans (garbage to prune), not first-class sessions.

      const tmuxSessions = [
        'TKT-100-Implement-agent1',  // Would be orphan if not in DB
        'TKT-200-Review-agent2',     // Would be orphan if not in DB
        'my-random-session',          // Not prlt pattern, should be ignored
        'dev-server',                 // Not prlt pattern, should be ignored
      ]

      // Only prlt-pattern sessions should be considered orphans
      const orphanCandidates = tmuxSessions.filter(s => parseSessionName(s) !== null)
      expect(orphanCandidates).to.deep.equal([
        'TKT-100-Implement-agent1',
        'TKT-200-Review-agent2',
      ])

      // Non-prlt sessions should be ignored entirely
      const nonPrlt = tmuxSessions.filter(s => parseSessionName(s) === null)
      expect(nonPrlt).to.deep.equal([
        'my-random-session',
        'dev-server',
      ])
    })
  })
})
