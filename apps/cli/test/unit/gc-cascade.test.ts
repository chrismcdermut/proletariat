import { expect } from 'chai'
import {
  executeCascade,
  type CascadeTarget,
  type CascadeResult,
  type CascadeOptions,
} from '../../src/lib/gc/cascade.js'

/**
 * Unit tests for the cascading cleanup module.
 *
 * These tests exercise the cascade orchestration logic (step ordering,
 * skip/fail behavior, dry-run mode) without requiring Docker, tmux,
 * or a real filesystem.  We pass minimal CascadeTarget objects so most
 * steps are skipped, then verify the result shape.
 */
describe('@smoke GC Cascade', () => {
  // ---------------------------------------------------------------------------
  // Dry-run mode
  // ---------------------------------------------------------------------------
  describe('dry-run mode (execute: false)', () => {
    it('should return all steps as skipped in dry-run', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: false })

      expect(result.agentName).to.equal('test-agent')
      expect(result.success).to.be.true
      expect(result.steps).to.be.an('array')
      // Every step should be skipped in dry-run
      for (const step of result.steps) {
        expect(step.skipped).to.be.true
        expect(step.success).to.be.true
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Step ordering
  // ---------------------------------------------------------------------------
  describe('step ordering', () => {
    it('should execute all 8 cascade steps in correct order', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const stepNames = result.steps.map(s => s.step)
      expect(stepNames).to.deep.equal([
        'claude-session',
        'tmux-session',
        'container',
        'worktree',
        'agent-directory',
        'git-branch',
        'execution-records',
        'db-status',
      ])
    })
  })

  // ---------------------------------------------------------------------------
  // Skipping logic
  // ---------------------------------------------------------------------------
  describe('skipping logic', () => {
    it('should skip container steps when no containerId provided', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
        // No containerId, sessionId, branch, etc.
      }
      const result = executeCascade(target, { execute: true })

      const claudeSession = result.steps.find(s => s.step === 'claude-session')
      expect(claudeSession?.skipped).to.be.true

      const container = result.steps.find(s => s.step === 'container')
      expect(container?.skipped).to.be.true
    })

    it('should skip tmux step when no sessionId and no containerId', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const tmux = result.steps.find(s => s.step === 'tmux-session')
      expect(tmux?.skipped).to.be.true
    })

    it('should skip worktree step when no worktreePath', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const worktree = result.steps.find(s => s.step === 'worktree')
      expect(worktree?.skipped).to.be.true
    })

    it('should skip agent-directory step when no agentDir', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const agentDir = result.steps.find(s => s.step === 'agent-directory')
      expect(agentDir?.skipped).to.be.true
    })

    it('should skip git-branch step when no branch', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const gitBranch = result.steps.find(s => s.step === 'git-branch')
      expect(gitBranch?.skipped).to.be.true
    })

    it('should skip git-branch when cascade.branch is disabled', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
        branch: 'feat/test-branch',
        sourceRepoPath: '/tmp/test-repo',
      }
      const result = executeCascade(target, {
        execute: true,
        config: { cascade: { branch: false, executionRecords: true } },
      })

      const gitBranch = result.steps.find(s => s.step === 'git-branch')
      expect(gitBranch?.skipped).to.be.true
    })

    it('should skip execution-records when no hqPath', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const execRecords = result.steps.find(s => s.step === 'execution-records')
      expect(execRecords?.skipped).to.be.true
    })

    it('should skip execution-records when cascade.executionRecords is disabled', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
        hqPath: '/tmp/hq',
      }
      const result = executeCascade(target, {
        execute: true,
        config: { cascade: { branch: true, executionRecords: false } },
      })

      const execRecords = result.steps.find(s => s.step === 'execution-records')
      expect(execRecords?.skipped).to.be.true
    })

    it('should skip db-status when no hqPath', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      const dbStatus = result.steps.find(s => s.step === 'db-status')
      expect(dbStatus?.skipped).to.be.true
    })
  })

  // ---------------------------------------------------------------------------
  // Overall success
  // ---------------------------------------------------------------------------
  describe('overall success', () => {
    it('should report success when all steps are skipped', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
      }
      const result = executeCascade(target, { execute: true })

      expect(result.success).to.be.true
    })

    it('should report success in dry-run mode', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
        containerId: 'abc123',
        branch: 'feat/test',
        hqPath: '/tmp/hq',
      }
      const result = executeCascade(target, { execute: false })

      expect(result.success).to.be.true
    })
  })

  // ---------------------------------------------------------------------------
  // Logging callback
  // ---------------------------------------------------------------------------
  describe('logging callback', () => {
    it('should not throw when log callback is not provided', () => {
      const target: CascadeTarget = { agentName: 'test-agent' }
      expect(() => executeCascade(target, { execute: true })).not.to.throw()
    })

    it('should accept a log callback without errors', () => {
      const logs: string[] = []
      const target: CascadeTarget = { agentName: 'test-agent' }
      executeCascade(target, { execute: true, log: (msg) => logs.push(msg) })
      // No errors logged for all-skipped cascade
      expect(logs).to.be.an('array')
    })
  })

  // ---------------------------------------------------------------------------
  // Result shape
  // ---------------------------------------------------------------------------
  describe('result shape', () => {
    it('should include agentName in result', () => {
      const target: CascadeTarget = { agentName: 'bold-turing' }
      const result = executeCascade(target)

      expect(result.agentName).to.equal('bold-turing')
    })

    it('should have step results with step, success, skipped fields', () => {
      const target: CascadeTarget = { agentName: 'test-agent' }
      const result = executeCascade(target, { execute: true })

      for (const step of result.steps) {
        expect(step).to.have.property('step').that.is.a('string')
        expect(step).to.have.property('success').that.is.a('boolean')
        expect(step).to.have.property('skipped').that.is.a('boolean')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Agent directory cleanup
  // ---------------------------------------------------------------------------
  describe('agent directory step', () => {
    it('should skip when agentDir does not exist', () => {
      const target: CascadeTarget = {
        agentName: 'test-agent',
        agentDir: '/tmp/nonexistent-dir-' + Date.now(),
      }
      const result = executeCascade(target, { execute: true })

      const agentDir = result.steps.find(s => s.step === 'agent-directory')
      expect(agentDir?.skipped).to.be.true
    })
  })
})
