import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'
import {
  readMachineState,
  buildMachineOrchestratorPrompt,
  type MachineState,
} from '../../src/lib/machine-orchestrator.js'

/**
 * PRLT-1245: Machine-level orchestrator tests.
 *
 * Tests the prompt builder and state reader that give the machine orchestrator
 * visibility into all agents across all repos.
 */

describe('PRLT-1245: Machine orchestrator', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-mach-orch-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // readMachineState
  // ===========================================================================

  describe('readMachineState()', () => {
    it('returns empty state for fresh database', () => {
      const state = readMachineState(db)

      expect(state.activeExecutions).to.deep.equal([])
      expect(state.persistentAgents).to.deep.equal([])
      expect(state.diedPersistentAgents).to.deep.equal([])
      expect(state.recentCompleted).to.deep.equal([])
      expect(state.activeRepos).to.deep.equal([])
    })

    it('captures active executions across repos', () => {
      const e1 = db.createExecution({
        prompt: 'fix auth',
        repoPath: '/projects/backend',
        agentName: 'agent-a',
      })
      db.updateStatus(e1.id, 'running')

      const e2 = db.createExecution({
        prompt: 'add tests',
        repoPath: '/projects/frontend',
        agentName: 'agent-b',
      })
      db.updateStatus(e2.id, 'running')

      const state = readMachineState(db)

      expect(state.activeExecutions).to.have.lengthOf(2)
      expect(state.activeRepos).to.have.lengthOf(2)
      expect(state.activeRepos).to.include('/projects/backend')
      expect(state.activeRepos).to.include('/projects/frontend')
    })

    it('includes persistent agents', () => {
      db.createExecution({
        prompt: 'backend reviewer',
        repoPath: '/projects/backend',
        agentName: 'reviewer',
        persistent: true,
      })

      const state = readMachineState(db)

      expect(state.persistentAgents).to.have.lengthOf(1)
      expect(state.persistentAgents[0].agentName).to.equal('reviewer')
    })

    it('detects died persistent agents', () => {
      const exec = db.createExecution({
        prompt: 'ci-watcher',
        repoPath: '/repo',
        agentName: 'ci-watcher',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')
      db.updateStatus(exec.id, 'failed', 1, 'OOM')

      const state = readMachineState(db)

      expect(state.diedPersistentAgents).to.have.lengthOf(1)
      expect(state.diedPersistentAgents[0].agentName).to.equal('ci-watcher')
    })

    it('includes recent completed executions', () => {
      const exec = db.createExecution({
        prompt: 'quick task',
        repoPath: '/repo',
        agentName: 'temp',
      })
      db.updateStatus(exec.id, 'completed', 0)

      const state = readMachineState(db)

      expect(state.recentCompleted).to.have.lengthOf(1)
    })
  })

  // ===========================================================================
  // buildMachineOrchestratorPrompt
  // ===========================================================================

  describe('buildMachineOrchestratorPrompt()', () => {
    it('includes orchestrator identity', () => {
      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Machine Orchestrator')
      expect(prompt).to.include('root supervisor')
      expect(prompt).to.include('all agents, all repos, all sessions')
    })

    it('includes command reference', () => {
      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('prlt work run')
      expect(prompt).to.include('prlt session list')
      expect(prompt).to.include('prlt session poke')
      expect(prompt).to.include('--keep-alive')
    })

    it('includes anti-patterns', () => {
      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('NEVER')
      expect(prompt).to.include('docker exec')
      expect(prompt).to.include('prlt session poke')
    })

    it('shows idle state when no agents', () => {
      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('No active agents')
      expect(prompt).to.include('idle')
    })

    it('shows active agents with repo paths', () => {
      const e1 = db.createExecution({
        prompt: 'fix the auth module',
        repoPath: '/home/user/projects/backend',
        agentName: 'auth-fixer',
      })
      db.updateStatus(e1.id, 'running')

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Active Agents (1)')
      expect(prompt).to.include('auth-fixer')
      expect(prompt).to.include('projects/backend')
      expect(prompt).to.include('fix the auth module')
    })

    it('shows persistent agents with their status', () => {
      const exec = db.createExecution({
        prompt: 'backend reviewer',
        repoPath: '/repo',
        agentName: 'reviewer',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')
      db.updateStatus(exec.id, 'stopped')

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Stopped Persistent Agents')
      expect(prompt).to.include('reviewer')
    })

    it('shows died persistent agents with restart commands', () => {
      const exec = db.createExecution({
        prompt: 'ci-watcher monitor',
        repoPath: '/projects/myapp',
        agentName: 'ci-watcher',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')
      db.updateStatus(exec.id, 'failed', 1, 'OOM killed')

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Died Persistent Agents')
      expect(prompt).to.include('ci-watcher')
      expect(prompt).to.include('prlt work run --name ci-watcher --keep-alive')
    })

    it('shows active repos summary', () => {
      const e1 = db.createExecution({
        prompt: 'task a',
        repoPath: '/repo-a',
        agentName: 'a',
      })
      db.updateStatus(e1.id, 'running')

      const e2 = db.createExecution({
        prompt: 'task b',
        repoPath: '/repo-a',
        agentName: 'b',
      })
      db.updateStatus(e2.id, 'running')

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Active Repos')
      expect(prompt).to.include('/repo-a')
      expect(prompt).to.include('2 agents')
    })

    it('includes custom action prompt when provided', () => {
      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state, 'Restart all died agents')

      expect(prompt).to.include('## Instructions')
      expect(prompt).to.include('Restart all died agents')
    })

    it('shows recent completions', () => {
      const exec = db.createExecution({
        prompt: 'refactor auth module completely',
        repoPath: '/projects/backend',
        agentName: 'agent-x',
      })
      db.updateStatus(exec.id, 'completed', 0)

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('Recent Completions')
      expect(prompt).to.include('agent-x')
      expect(prompt).to.include('refactor auth module completely')
    })

    it('marks persistent agents in the active table', () => {
      const exec = db.createExecution({
        prompt: 'watch CI',
        repoPath: '/repo',
        agentName: 'watcher',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')

      const state = readMachineState(db)
      const prompt = buildMachineOrchestratorPrompt(state)

      expect(prompt).to.include('(persistent)')
    })
  })

  // ===========================================================================
  // Machine orchestrator as persistent agent
  // ===========================================================================

  describe('orchestrator is a persistent agent in machine.db', () => {
    it('creates orchestrator as a persistent execution', () => {
      const exec = db.createExecution({
        prompt: 'Machine-level orchestrator',
        repoPath: os.homedir(),
        agentName: 'machine-orchestrator',
        persistent: true,
        cleanupPolicy: 'persistent',
      })

      expect(exec.persistent).to.be.true
      expect(exec.cleanupPolicy).to.equal('persistent')
      expect(exec.agentName).to.equal('machine-orchestrator')
    })

    it('can be found via getPersistentAgent', () => {
      db.createExecution({
        prompt: 'Machine-level orchestrator',
        repoPath: os.homedir(),
        agentName: 'machine-orchestrator',
        persistent: true,
      })

      const found = db.getPersistentAgent('machine-orchestrator')
      expect(found).to.not.be.null
      expect(found!.agentName).to.equal('machine-orchestrator')
    })

    it('appears in listPersistentAgents', () => {
      db.createExecution({
        prompt: 'Machine orchestrator',
        repoPath: os.homedir(),
        agentName: 'machine-orchestrator',
        persistent: true,
      })

      const agents = db.listPersistentAgents()
      const names = agents.map(a => a.agentName)
      expect(names).to.include('machine-orchestrator')
    })

    it('orchestrator sees itself in machine state', () => {
      const exec = db.createExecution({
        prompt: 'Machine orchestrator',
        repoPath: os.homedir(),
        agentName: 'machine-orchestrator',
        persistent: true,
      })
      db.updateStatus(exec.id, 'running')

      // Also add some other agents
      const e2 = db.createExecution({
        prompt: 'worker task',
        repoPath: '/repo',
        agentName: 'worker',
      })
      db.updateStatus(e2.id, 'running')

      const state = readMachineState(db)
      expect(state.activeExecutions).to.have.lengthOf(2)

      const prompt = buildMachineOrchestratorPrompt(state)
      expect(prompt).to.include('machine-orchestrator')
      expect(prompt).to.include('worker')
    })
  })
})
