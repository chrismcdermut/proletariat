import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  parseOrchestratorSessionId,
  enrichOrchestratorSession,
  enrichOrchestratorSessionFromMachineDb,
  findMachineOrchestratorExecution,
  formatOrchestratorSessionLabel,
  formatHomePath,
  type OrchestratorSessionInfo,
} from '../../src/commands/orchestrator/start.js'
import { MachineDB } from '../../src/lib/machine-db.js'

/**
 * PRLT-1271: Orchestrator session enrichment helpers.
 *
 * Validates that picker/status displays can resolve a tmux/container session
 * id back to the HQ name + path it belongs to, so users see the working
 * directory of each running orchestrator instead of an opaque session id.
 */

describe('PRLT-1271: orchestrator session info helpers', () => {
  describe('parseOrchestratorSessionId', () => {
    it('returns suffix as orchestrator name when no HQs are registered', () => {
      const result = parseOrchestratorSessionId('prlt-orchestrator-foo-main', [])
      expect(result.hqName).to.equal(null)
      expect(result.hqPath).to.equal(null)
      expect(result.orchestratorName).to.equal('foo-main')
    })

    it('returns the entire session id verbatim if it lacks the prefix', () => {
      const result = parseOrchestratorSessionId('something-else', [])
      expect(result.hqName).to.equal(null)
      expect(result.hqPath).to.equal(null)
      expect(result.orchestratorName).to.equal('something-else')
    })

    it('matches a registered HQ by sanitized name', () => {
      const result = parseOrchestratorSessionId(
        'prlt-orchestrator-proletariat-main',
        [{ name: 'proletariat', path: '/Users/me/Projects/proletariat' }],
      )
      expect(result.hqName).to.equal('proletariat')
      expect(result.hqPath).to.equal('/Users/me/Projects/proletariat')
      expect(result.orchestratorName).to.equal('main')
    })

    it('extracts non-main orchestrator names', () => {
      const result = parseOrchestratorSessionId(
        'prlt-orchestrator-proletariat-reviewer',
        [{ name: 'proletariat', path: '/repo' }],
      )
      expect(result.orchestratorName).to.equal('reviewer')
    })

    it('handles multi-segment orchestrator names like main-2', () => {
      const result = parseOrchestratorSessionId(
        'prlt-orchestrator-proletariat-main-2',
        [{ name: 'proletariat', path: '/repo' }],
      )
      expect(result.hqName).to.equal('proletariat')
      expect(result.orchestratorName).to.equal('main-2')
    })

    it('prefers the longest matching HQ prefix when multiple HQs share a stem', () => {
      // 'foo' and 'foo-bar' both register; session belongs to 'foo-bar'.
      const result = parseOrchestratorSessionId(
        'prlt-orchestrator-foo-bar-main',
        [
          { name: 'foo', path: '/projects/foo' },
          { name: 'foo-bar', path: '/projects/foo-bar' },
        ],
      )
      expect(result.hqName).to.equal('foo-bar')
      expect(result.hqPath).to.equal('/projects/foo-bar')
      expect(result.orchestratorName).to.equal('main')
    })

    it('skips HQs whose prefix matches but leaves no orchestrator name', () => {
      const result = parseOrchestratorSessionId(
        'prlt-orchestrator-proletariat-',
        [{ name: 'proletariat', path: '/repo' }],
      )
      expect(result.hqName).to.equal(null)
      expect(result.orchestratorName).to.equal('proletariat-')
    })
  })

  describe('enrichOrchestratorSession', () => {
    it('returns null hq context when not in any registered HQ', () => {
      const info = enrichOrchestratorSession('prlt-orchestrator-unknown-main', false, [])
      expect(info.sessionId).to.equal('prlt-orchestrator-unknown-main')
      expect(info.orchestratorName).to.equal('unknown-main')
      expect(info.hqName).to.equal(null)
      expect(info.hqPath).to.equal(null)
      expect(info.isDocker).to.equal(false)
    })

    it('flags Docker sessions correctly', () => {
      const info = enrichOrchestratorSession(
        'prlt-orchestrator-proletariat-main',
        true,
        [{ name: 'proletariat', path: '/repo' }],
      )
      expect(info.isDocker).to.equal(true)
      expect(info.hqPath).to.equal('/repo')
      expect(info.orchestratorName).to.equal('main')
    })
  })

  describe('formatHomePath', () => {
    const originalHome = process.env.HOME

    beforeEach(() => {
      process.env.HOME = '/Users/test'
    })

    afterEach(() => {
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    })

    it('replaces home with tilde', () => {
      expect(formatHomePath('/Users/test/Projects/foo')).to.equal('~/Projects/foo')
    })

    it('returns ~ for the home dir itself', () => {
      expect(formatHomePath('/Users/test')).to.equal('~')
    })

    it('leaves unrelated paths untouched', () => {
      expect(formatHomePath('/etc/hosts')).to.equal('/etc/hosts')
    })

    it('does not collapse a sibling directory that shares a prefix', () => {
      // /Users/testing should NOT become ~ing
      expect(formatHomePath('/Users/testing/foo')).to.equal('/Users/testing/foo')
    })

    it('handles Windows-style paths via path.sep', () => {
      // On posix this is a no-op; we just guard against the bug where
      // formatHomePath would naively use '/' as the separator.
      const homedirPath = process.env.HOME + path.sep + 'a'
      expect(formatHomePath(homedirPath)).to.equal('~' + path.sep + 'a')
    })
  })

  describe('findMachineOrchestratorExecution', () => {
    let tmpDir: string
    let dbPath: string
    let db: MachineDB

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-orch-session-info-')))
      dbPath = path.join(tmpDir, 'machine.db')
      db = new MachineDB(dbPath)
    })

    afterEach(() => {
      db.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('finds a running orchestrator by sessionId', () => {
      const exec = db.createExecution({
        prompt: 'orchestrator: main',
        repoPath: '/projects/backend',
        agentName: 'orchestrator-main',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, { sessionId: 'prlt-orchestrator-backend-main' })

      const found = findMachineOrchestratorExecution(db, 'prlt-orchestrator-backend-main')
      expect(found).to.not.be.null
      expect(found!.repoPath).to.equal('/projects/backend')
      expect(found!.agentName).to.equal('orchestrator-main')
    })

    it('returns null when no matching orchestrator exists', () => {
      const exec = db.createExecution({
        prompt: 'worker',
        repoPath: '/projects/backend',
        agentName: 'worker', // NOT an orchestrator — must be ignored
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, { sessionId: 'some-session' })

      const found = findMachineOrchestratorExecution(db, 'some-session')
      expect(found).to.be.null
    })

    it('matches by containerId for Docker sessions', () => {
      const exec = db.createExecution({
        prompt: 'orchestrator: reviewer',
        repoPath: '/projects/frontend',
        agentName: 'orchestrator-reviewer',
        environment: 'docker',
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, {
        sessionId: 'prlt-orchestrator-frontend-reviewer',
        containerId: 'abc123def456',
      })

      // Match by container id even if session id does not match.
      const found = findMachineOrchestratorExecution(db, 'some-other-id', 'abc123def456')
      expect(found).to.not.be.null
      expect(found!.repoPath).to.equal('/projects/frontend')
    })

    it('ignores non-orchestrator agents with matching session ids', () => {
      // Create a worker agent with the SAME sessionId as an orchestrator would
      // use — findMachineOrchestratorExecution must filter by agent name.
      const worker = db.createExecution({
        prompt: 'worker',
        repoPath: '/projects/backend',
        agentName: 'worker',
      })
      db.updateStatus(worker.id, 'running')
      db.updateProcessInfo(worker.id, { sessionId: 'prlt-orchestrator-backend-main' })

      const found = findMachineOrchestratorExecution(db, 'prlt-orchestrator-backend-main')
      expect(found).to.be.null
    })

    it('ignores completed/stopped orchestrator executions', () => {
      const exec = db.createExecution({
        prompt: 'orchestrator: main',
        repoPath: '/projects/backend',
        agentName: 'orchestrator-main',
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, { sessionId: 'prlt-orchestrator-backend-main' })
      db.updateStatus(exec.id, 'stopped')

      const found = findMachineOrchestratorExecution(db, 'prlt-orchestrator-backend-main')
      expect(found).to.be.null
    })
  })

  describe('enrichOrchestratorSessionFromMachineDb', () => {
    let tmpDir: string
    let dbPath: string
    let db: MachineDB

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-orch-enrich-')))
      dbPath = path.join(tmpDir, 'machine.db')
      db = new MachineDB(dbPath)
    })

    afterEach(() => {
      db.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('uses machine.db repo_path as the authoritative hqPath', () => {
      // HQ basename matches an unrelated registered HQ, but machine.db
      // overrides it with the actual originating repo path.
      const exec = db.createExecution({
        prompt: 'orchestrator: main',
        repoPath: '/actual/originating/path',
        agentName: 'orchestrator-main',
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, { sessionId: 'prlt-orchestrator-backend-main' })

      const info = enrichOrchestratorSessionFromMachineDb(
        'prlt-orchestrator-backend-main',
        false,
        db,
        undefined,
        [{ name: 'backend', path: '/stale/wrong/path' }],
      )

      expect(info.hqPath).to.equal('/actual/originating/path')
      expect(info.orchestratorName).to.equal('main')
    })

    it('derives orchestrator name from the agent_name column', () => {
      const exec = db.createExecution({
        prompt: 'orchestrator: reviewer',
        repoPath: '/repo',
        agentName: 'orchestrator-reviewer',
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, { sessionId: 'some-opaque-session-id' })

      const info = enrichOrchestratorSessionFromMachineDb(
        'some-opaque-session-id',
        false,
        db,
      )
      expect(info.orchestratorName).to.equal('reviewer')
    })

    it('falls back to registry enrichment when machine.db has no record', () => {
      const info = enrichOrchestratorSessionFromMachineDb(
        'prlt-orchestrator-backend-main',
        false,
        db, // empty — no matching execution
        undefined,
        [{ name: 'backend', path: '/projects/backend' }],
      )

      expect(info.hqPath).to.equal('/projects/backend')
      expect(info.hqName).to.equal('backend')
      expect(info.orchestratorName).to.equal('main')
    })

    it('falls back to registry enrichment when machine.db is null', () => {
      const info = enrichOrchestratorSessionFromMachineDb(
        'prlt-orchestrator-backend-main',
        false,
        null,
        undefined,
        [{ name: 'backend', path: '/projects/backend' }],
      )

      expect(info.hqPath).to.equal('/projects/backend')
      expect(info.orchestratorName).to.equal('main')
    })

    it('preserves the Docker flag when enriching', () => {
      const exec = db.createExecution({
        prompt: 'orchestrator: main',
        repoPath: '/projects/dockerized',
        agentName: 'orchestrator-main',
        environment: 'docker',
      })
      db.updateStatus(exec.id, 'running')
      db.updateProcessInfo(exec.id, {
        sessionId: 'prlt-orchestrator-dockerized-main',
        containerId: 'abc123',
      })

      const info = enrichOrchestratorSessionFromMachineDb(
        'prlt-orchestrator-dockerized-main',
        true,
        db,
        'abc123',
      )
      expect(info.isDocker).to.equal(true)
      expect(info.hqPath).to.equal('/projects/dockerized')
    })
  })

  describe('formatOrchestratorSessionLabel', () => {
    const originalHome = process.env.HOME

    beforeEach(() => {
      process.env.HOME = '/Users/test'
    })

    afterEach(() => {
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    })

    it('renders the example shown in the ticket spec', () => {
      const info: OrchestratorSessionInfo = {
        sessionId: 'prlt-orchestrator-backend-main',
        orchestratorName: 'main',
        hqName: 'backend',
        hqPath: '/Users/test/Projects/backend',
        isDocker: false,
      }
      expect(formatOrchestratorSessionLabel(info)).to.equal('main (running, ~/Projects/backend)')
    })

    it('falls back to "host" when HQ context is unknown', () => {
      const info: OrchestratorSessionInfo = {
        sessionId: 'prlt-orchestrator-unknown-reviewer',
        orchestratorName: 'reviewer',
        hqName: null,
        hqPath: null,
        isDocker: false,
      }
      expect(formatOrchestratorSessionLabel(info)).to.equal('reviewer (running, host)')
    })

    it('marks Docker sessions in the label', () => {
      const info: OrchestratorSessionInfo = {
        sessionId: 'prlt-orchestrator-proletariat-backend',
        orchestratorName: 'backend',
        hqName: 'proletariat',
        hqPath: '/Users/test/Projects/proletariat-hq',
        isDocker: true,
      }
      expect(formatOrchestratorSessionLabel(info)).to.equal(
        'backend (running, ~/Projects/proletariat-hq, Docker)',
      )
    })
  })
})
