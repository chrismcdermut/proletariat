import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB, ensureMachineDb, cleanupStaleMachineDb, getMachineDbPath } from '../../src/lib/machine-db.js'

describe('machine-db initialization (PRLT-1338)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-machinedb-init-')))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // ensureMachineDb()
  // ===========================================================================

  describe('ensureMachineDb()', () => {
    it('creates and initializes machine.db at the default path', () => {
      // The real ensureMachineDb targets ~/.proletariat/machine.db.
      // We verify indirectly: the function should not throw and the
      // default path should exist with tables after the call.
      ensureMachineDb()

      const dbPath = getMachineDbPath()
      expect(fs.existsSync(dbPath)).to.be.true

      // Verify the file is not 0 bytes (has schema)
      const stat = fs.statSync(dbPath)
      expect(stat.size).to.be.greaterThan(0)
    })

    it('is idempotent — calling twice does not throw or corrupt', () => {
      ensureMachineDb()
      ensureMachineDb()

      const dbPath = getMachineDbPath()
      // After two calls, DB should still be valid
      const db = new MachineDB()
      const execs = db.listExecutions()
      expect(execs).to.be.an('array')
      db.close()
    })
  })

  // ===========================================================================
  // cleanupStaleMachineDb()
  // ===========================================================================

  describe('cleanupStaleMachineDb()', () => {
    it('removes a 0-byte machine.db at the given path', () => {
      const staleFile = path.join(tmpDir, 'machine.db')
      fs.writeFileSync(staleFile, '')

      expect(fs.existsSync(staleFile)).to.be.true
      expect(fs.statSync(staleFile).size).to.equal(0)

      const removed = cleanupStaleMachineDb(tmpDir)

      expect(removed).to.be.true
      expect(fs.existsSync(staleFile)).to.be.false
    })

    it('does NOT remove a non-empty machine.db', () => {
      const nonEmptyFile = path.join(tmpDir, 'machine.db')
      fs.writeFileSync(nonEmptyFile, 'some data')

      const removed = cleanupStaleMachineDb(tmpDir)

      expect(removed).to.be.false
      expect(fs.existsSync(nonEmptyFile)).to.be.true
    })

    it('returns false when no machine.db exists at the path', () => {
      const removed = cleanupStaleMachineDb(tmpDir)
      expect(removed).to.be.false
    })

    it('returns false for non-existent directory', () => {
      const removed = cleanupStaleMachineDb(path.join(tmpDir, 'nonexistent'))
      expect(removed).to.be.false
    })
  })

  // ===========================================================================
  // MachineDB constructor — schema initialization
  // ===========================================================================

  describe('MachineDB schema initialization', () => {
    it('creates all four tables on construction', () => {
      const dbPath = path.join(tmpDir, 'machine.db')
      const db = new MachineDB(dbPath)

      // Verify by exercising all tables

      // executions
      const exec = db.createExecution({
        prompt: 'test',
        repoPath: '/repo',
        agentName: 'agent-1',
      })
      expect(exec.id).to.match(/^MRUN-/)

      // agent_health
      db.updateHeartbeat(exec.id)
      const health = db.getHealth(exec.id)
      expect(health).to.not.be.null

      // messaging_channels
      db.upsertMessagingChannel({
        name: 'test-channel',
        type: 'telegram',
        configJson: '{}',
      })
      const channel = db.getMessagingChannel('test-channel')
      expect(channel).to.not.be.null
      expect(channel!.type).to.equal('telegram')

      // messaging_routes
      const route = db.upsertMessagingRoute({
        channel: 'test-channel',
        userId: 'user-1',
        agentSessionId: exec.id,
      })
      expect(route.channel).to.equal('test-channel')

      db.close()
    })

    it('does not create an empty 0-byte file', () => {
      const dbPath = path.join(tmpDir, 'fresh.db')
      const db = new MachineDB(dbPath)

      const stat = fs.statSync(dbPath)
      expect(stat.size).to.be.greaterThan(0)

      db.close()
    })
  })
})
