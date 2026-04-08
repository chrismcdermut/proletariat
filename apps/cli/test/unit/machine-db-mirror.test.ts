import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'
import {
  createMirrorExecution,
  updateMirrorExecution,
  closeMirrorExecution,
} from '../../src/lib/machine-db-mirror.js'

/**
 * PRLT-1275: Tests for the machine.db mirror helper used by `prlt work start`
 * and `prlt orchestrator start` to surface their executions machine-wide.
 *
 * Each test passes an explicit `machineDbPath` so it doesn't collide with the
 * user's real ~/.proletariat/machine.db or with other parallel tests.
 */
describe('machine-db-mirror (PRLT-1275)', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-mirror-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('createMirrorExecution', () => {
    it('writes a row to machine.db with the expected fields', () => {
      const handle = createMirrorExecution({
        ticketId: 'PRLT-1275',
        agentName: 'bold-fox',
        executor: 'claude-code',
        environment: 'host',
        repoPath: '/home/user/hq',
        branch: 'PRLT-1275/feat/migrate',
        prompt: 'PRLT-1275: Migrate work start',
        machineDbPath: dbPath,
      })

      expect(handle).to.not.be.null
      expect(handle!.execution.id).to.match(/^MRUN-[A-Z0-9]{8}$/)
      expect(handle!.execution.ticketId).to.equal('PRLT-1275')
      expect(handle!.execution.agentName).to.equal('bold-fox')
      expect(handle!.execution.executor).to.equal('claude-code')
      expect(handle!.execution.environment).to.equal('host')
      expect(handle!.execution.repoPath).to.equal('/home/user/hq')
      expect(handle!.execution.branch).to.equal('PRLT-1275/feat/migrate')
      expect(handle!.execution.status).to.equal('starting')
      expect(handle!.execution.persistent).to.be.false

      closeMirrorExecution(handle)

      // Re-open and verify the row persisted.
      expect(fs.existsSync(dbPath)).to.be.true
      const db = new MachineDB(dbPath)
      try {
        const row = db.getExecution(handle!.execution.id)
        expect(row).to.not.be.null
        expect(row!.ticketId).to.equal('PRLT-1275')
        expect(row!.agentName).to.equal('bold-fox')
      } finally {
        db.close()
      }
    })

    it('creates a persistent orchestrator-style row', () => {
      const handle = createMirrorExecution({
        ticketId: 'ORCH',
        agentName: 'orchestrator-main',
        executor: 'claude-code',
        environment: 'host',
        repoPath: '/home/user/hq-a',
        persistent: true,
        prompt: 'Orchestrator main',
        machineDbPath: dbPath,
      })

      expect(handle).to.not.be.null
      expect(handle!.execution.agentName).to.equal('orchestrator-main')
      expect(handle!.execution.persistent).to.be.true
      expect(handle!.execution.cleanupPolicy).to.equal('persistent')

      closeMirrorExecution(handle)
    })
  })

  describe('updateMirrorExecution', () => {
    it('updates status and process info on the mirrored row', () => {
      const handle = createMirrorExecution({
        ticketId: 'TKT-999',
        agentName: 'calm-ray',
        executor: 'claude-code',
        environment: 'host',
        repoPath: '/home/user/hq',
        machineDbPath: dbPath,
      })
      expect(handle).to.not.be.null

      updateMirrorExecution(handle, {
        status: 'running',
        sessionId: 'prlt-implement-TKT-999-calm-ray',
        containerId: undefined,
      })

      const updated = handle!.machineDb.getExecution(handle!.execution.id)!
      expect(updated.status).to.equal('running')
      expect(updated.sessionId).to.equal('prlt-implement-TKT-999-calm-ray')

      closeMirrorExecution(handle)
    })

    it('records failure reason via errorMessage', () => {
      const handle = createMirrorExecution({
        ticketId: 'TKT-500',
        agentName: 'still-dawn',
        executor: 'claude-code',
        environment: 'host',
        repoPath: '/home/user/hq',
        machineDbPath: dbPath,
      })

      updateMirrorExecution(handle, {
        status: 'failed',
        errorMessage: 'docker not running',
      })

      const updated = handle!.machineDb.getExecution(handle!.execution.id)!
      expect(updated.status).to.equal('failed')
      expect(updated.errorMessage).to.equal('docker not running')
      expect(updated.completedAt).to.be.instanceOf(Date)

      closeMirrorExecution(handle)
    })

    it('is a no-op when given a null handle', () => {
      // Should not throw.
      updateMirrorExecution(null, { status: 'running' })
      closeMirrorExecution(null)
    })
  })

  describe('MachineDB helpers added for PRLT-1275', () => {
    it('getActiveByAgentPrefix returns only matching active executions', () => {
      const db = new MachineDB(dbPath)
      try {
        const a = db.createExecution({
          prompt: 'orch a',
          repoPath: '/hq-a',
          agentName: 'orchestrator-main',
          persistent: true,
        })
        db.updateStatus(a.id, 'running')

        const b = db.createExecution({
          prompt: 'orch b',
          repoPath: '/hq-b',
          agentName: 'orchestrator-reviewer',
          persistent: true,
        })
        db.updateStatus(b.id, 'running')

        // A ticketed execution — should NOT match the orchestrator prefix.
        db.createExecution({
          prompt: 'work',
          repoPath: '/hq-a',
          agentName: 'bold-fox',
        })

        const orchestrators = db.getActiveByAgentPrefix('orchestrator-')
        expect(orchestrators).to.have.lengthOf(2)
        const names = orchestrators.map(o => o.agentName).sort()
        expect(names).to.deep.equal(['orchestrator-main', 'orchestrator-reviewer'])
      } finally {
        db.close()
      }
    })

    it('getActiveByAgentPrefix ignores completed/stopped rows', () => {
      const db = new MachineDB(dbPath)
      try {
        const a = db.createExecution({
          prompt: 'orch a',
          repoPath: '/hq-a',
          agentName: 'orchestrator-main',
        })
        db.updateStatus(a.id, 'stopped')

        const b = db.createExecution({
          prompt: 'orch b',
          repoPath: '/hq-b',
          agentName: 'orchestrator-reviewer',
        })
        db.updateStatus(b.id, 'running')

        const active = db.getActiveByAgentPrefix('orchestrator-')
        expect(active).to.have.lengthOf(1)
        expect(active[0].agentName).to.equal('orchestrator-reviewer')
      } finally {
        db.close()
      }
    })

    it('findBySessionId returns the execution owning a session', () => {
      const db = new MachineDB(dbPath)
      try {
        const exec = db.createExecution({
          prompt: 'x',
          repoPath: '/hq',
          agentName: 'orchestrator-main',
          persistent: true,
        })
        db.updateProcessInfo(exec.id, { sessionId: 'prlt-orchestrator-hq-main' })
        db.updateStatus(exec.id, 'running')

        const found = db.findBySessionId('prlt-orchestrator-hq-main')
        expect(found).to.not.be.null
        expect(found!.id).to.equal(exec.id)

        expect(db.findBySessionId('nope')).to.be.null
      } finally {
        db.close()
      }
    })
  })
})
