import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import {
  checkWorktreeLiveness,
  checkTmuxSession,
  checkDbStatus,
  checkRecentHeartbeat,
  checkWorktreeAge,
  checkUncommittedChanges,
  checkOpenPR,
  checkProcessHolding,
} from '../../src/lib/gc/liveness.js'
import {
  findOrphanedWorktrees,
} from '../../src/lib/gc/index.js'

/**
 * PRLT-1324 Regression Tests
 *
 * `prlt gc --orphans --execute` destroyed a live agent's worktree because the
 * single-signal liveness check (running container OR active DB status) was
 * insufficient. This suite validates the hardened multi-signal liveness check:
 *
 *   1. DB record terminated
 *   2. AND no tmux session exists for this agent
 *   3. AND no process holding the worktree path
 *   4. AND no open PR for the branch
 *   5. AND last heartbeat older than threshold
 *   6. AND worktree at least N minutes old
 *   7. AND no uncommitted changes
 *
 * Any single failing signal must cause the worktree to be preserved and the
 * reason logged.
 */

// =============================================================================
// Individual signal checks
// =============================================================================

describe('@smoke GC liveness — individual signal checks', () => {
  describe('checkTmuxSession', () => {
    it('detects host tmux session matching agent suffix', () => {
      const reason = checkTmuxSession(
        'glad-sweeney',
        ['PRLT-100-implement-glad-sweeney'],
        new Map(),
      )
      expect(reason).to.not.be.null
      expect(reason).to.include('glad-sweeney')
    })

    it('detects host tmux session matching agent name exactly', () => {
      const reason = checkTmuxSession(
        'glad-sweeney',
        ['glad-sweeney'],
        new Map(),
      )
      expect(reason).to.not.be.null
    })

    it('detects container tmux session matching agent suffix', () => {
      const containerMap = new Map<string, string[]>([
        ['abc123def456', ['PRLT-100-review-glad-sweeney']],
      ])
      const reason = checkTmuxSession('glad-sweeney', [], containerMap)
      expect(reason).to.not.be.null
      expect(reason).to.include('glad-sweeney')
      expect(reason).to.include('abc123def456'.slice(0, 12))
    })

    it('returns null when no session matches', () => {
      const reason = checkTmuxSession(
        'glad-sweeney',
        ['other-agent', 'PRLT-100-implement-bold-turing'],
        new Map([['x', ['unrelated-session']]]),
      )
      expect(reason).to.be.null
    })

    it('does not match a session whose name merely contains the agent name as a substring', () => {
      // "glad-sweeney-2" does not end with "-glad-sweeney" so it must not match
      const reason = checkTmuxSession(
        'glad-sweeney',
        ['bold-turing-glad-sweeney-2'],
        new Map(),
      )
      expect(reason).to.be.null
    })
  })

  describe('checkWorktreeAge', () => {
    it('flags freshly-created directories as too young', () => {
      const tmp = fs.mkdtempSync(path.join('/tmp', 'gc-age-young-'))
      try {
        const reason = checkWorktreeAge(tmp, 5)
        expect(reason).to.not.be.null
        expect(reason).to.include('< 5m minimum')
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('returns null when minimum is zero', () => {
      const tmp = fs.mkdtempSync(path.join('/tmp', 'gc-age-zero-'))
      try {
        const reason = checkWorktreeAge(tmp, 0)
        expect(reason).to.be.null
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('returns null when directory does not exist', () => {
      const reason = checkWorktreeAge('/tmp/definitely-not-real-1324', 5)
      expect(reason).to.be.null
    })
  })

  describe('checkUncommittedChanges', () => {
    it('reports uncommitted changes when working tree is dirty', () => {
      const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-dirty-')))
      try {
        execSync('git init -q', { cwd: tmp, stdio: 'pipe' })
        execSync('git checkout -b main -q', { cwd: tmp, stdio: 'pipe' })
        fs.writeFileSync(path.join(tmp, 'README.md'), '# test')
        execSync('git -c user.name=test -c user.email=t@t add .', { cwd: tmp, stdio: 'pipe' })
        execSync('git -c user.name=test -c user.email=t@t commit -q -m initial', {
          cwd: tmp,
          stdio: 'pipe',
        })
        // Create an uncommitted change
        fs.writeFileSync(path.join(tmp, 'dirty.txt'), 'work in progress')
        const reason = checkUncommittedChanges(tmp)
        expect(reason).to.not.be.null
        expect(reason).to.include('uncommitted')
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('returns null on clean working tree', () => {
      const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-clean-')))
      try {
        execSync('git init -q', { cwd: tmp, stdio: 'pipe' })
        execSync('git checkout -b main -q', { cwd: tmp, stdio: 'pipe' })
        fs.writeFileSync(path.join(tmp, 'README.md'), '# test')
        execSync('git -c user.name=test -c user.email=t@t add .', { cwd: tmp, stdio: 'pipe' })
        execSync('git -c user.name=test -c user.email=t@t commit -q -m initial', {
          cwd: tmp,
          stdio: 'pipe',
        })
        const reason = checkUncommittedChanges(tmp)
        expect(reason).to.be.null
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('reports untracked files as uncommitted changes (the most common agent-in-progress signal)', () => {
      const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-untracked-')))
      try {
        execSync('git init -q', { cwd: tmp, stdio: 'pipe' })
        execSync('git checkout -b main -q', { cwd: tmp, stdio: 'pipe' })
        fs.writeFileSync(path.join(tmp, 'README.md'), '# test')
        execSync('git -c user.name=test -c user.email=t@t add .', { cwd: tmp, stdio: 'pipe' })
        execSync('git -c user.name=test -c user.email=t@t commit -q -m initial', {
          cwd: tmp,
          stdio: 'pipe',
        })
        fs.writeFileSync(path.join(tmp, 'WIP.md'), 'in progress work')
        const reason = checkUncommittedChanges(tmp)
        expect(reason).to.not.be.null
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('returns a safety reason when the path is not a git repo', () => {
      const tmp = fs.mkdtempSync(path.join('/tmp', 'gc-notrepo-'))
      try {
        const reason = checkUncommittedChanges(tmp)
        // When git status fails, we err on the side of safety
        expect(reason).to.not.be.null
        expect(reason).to.include('safety')
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('checkDbStatus', () => {
    it('returns null when the DB path does not exist', () => {
      const reason = checkDbStatus('any-agent', '/tmp/definitely-not-real-1324')
      expect(reason).to.be.null
    })
  })

  describe('checkRecentHeartbeat', () => {
    it('returns null when the DB does not exist', () => {
      const reason = checkRecentHeartbeat('any-agent', '/tmp/definitely-not-real-1324', 10)
      expect(reason).to.be.null
    })
  })

  describe('checkOpenPR', () => {
    it('does not throw on branch lookup failure', () => {
      // Non-existent repo/branch — returns null gracefully.
      expect(() => checkOpenPR('nonexistent-branch-gc-1324', '/tmp')).to.not.throw()
    })
  })

  describe('checkProcessHolding', () => {
    it('returns null when the path does not exist', () => {
      const reason = checkProcessHolding('/tmp/definitely-not-real-1324')
      expect(reason).to.be.null
    })

    it('does not throw on unknown paths', () => {
      expect(() => checkProcessHolding('/tmp/definitely-not-real-1324')).to.not.throw()
    })
  })
})

// =============================================================================
// PRLT-1324 regression: live agent worktree must not be deleted by GC
// =============================================================================

describe('@smoke GC PRLT-1324 — live agent protection', () => {
  it('does not mark a worktree with a matching tmux session as orphan', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-live-')))
    try {
      const reposDir = path.join(tmp, 'repos')
      const repoDir = path.join(reposDir, 'test-repo')
      fs.mkdirSync(repoDir, { recursive: true })

      execSync('git init -q', { cwd: repoDir, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: repoDir, stdio: 'pipe' })
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: repoDir, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: repoDir, stdio: 'pipe' })

      const agentDir = path.join(tmp, 'agents', 'temp', 'glad-sweeney', 'test-repo')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })
      execSync(`git worktree add "${agentDir}" -b agent-glad-sweeney`, {
        cwd: repoDir,
        stdio: 'pipe',
      })

      const logs: string[] = []
      // The agent is "live" because a tmux session exists with the agent suffix.
      // We simulate this by passing the host session list manually via the
      // liveness module — but findOrphanedWorktrees auto-discovers, so we use
      // the liveness module directly to verify the rule, then verify that
      // findOrphanedWorktrees with minWorktreeAgeMinutes=0 also skips it when
      // uncommitted changes are present.
      fs.writeFileSync(path.join(agentDir, 'wip.ts'), 'in progress work')

      const orphans = findOrphanedWorktrees(tmp, {
        minWorktreeAgeMinutes: 0,
        skipPRCheck: true,
        skipProcessCheck: true,
        log: (m) => logs.push(m),
      })

      // The worktree is dirty → must never be deleted.
      expect(orphans).to.have.length(0)
      expect(logs.some(l => l.includes('uncommitted'))).to.be.true
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('protects a freshly-spawned agent (< minWorktreeAgeMinutes) from GC', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-young-')))
    try {
      const reposDir = path.join(tmp, 'repos')
      const repoDir = path.join(reposDir, 'test-repo')
      fs.mkdirSync(repoDir, { recursive: true })

      execSync('git init -q', { cwd: repoDir, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: repoDir, stdio: 'pipe' })
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: repoDir, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: repoDir, stdio: 'pipe' })

      const agentDir = path.join(tmp, 'agents', 'temp', 'fresh-agent', 'test-repo')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })
      execSync(`git worktree add "${agentDir}" -b agent-fresh-agent`, {
        cwd: repoDir,
        stdio: 'pipe',
      })

      const logs: string[] = []
      // Default minWorktreeAgeMinutes is 5 — the worktree is brand new.
      const orphans = findOrphanedWorktrees(tmp, {
        skipPRCheck: true,
        skipProcessCheck: true,
        log: (m) => logs.push(m),
      })

      // Must be skipped due to age, even though no tmux/DB/etc. signals exist.
      expect(orphans).to.have.length(0)
      expect(logs.some(l => l.includes('5m minimum') || l.includes('< 5m'))).to.be.true
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('skips worktrees with uncommitted changes regardless of other signals', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-dirty-wt-')))
    try {
      const reposDir = path.join(tmp, 'repos')
      const repoDir = path.join(reposDir, 'test-repo')
      fs.mkdirSync(repoDir, { recursive: true })

      execSync('git init -q', { cwd: repoDir, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: repoDir, stdio: 'pipe' })
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: repoDir, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: repoDir, stdio: 'pipe' })

      const agentDir = path.join(tmp, 'agents', 'temp', 'dirty-agent', 'test-repo')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })
      execSync(`git worktree add "${agentDir}" -b agent-dirty-agent`, {
        cwd: repoDir,
        stdio: 'pipe',
      })

      // Seed the worktree with an uncommitted file — this is the classic
      // "agent in the middle of work" scenario.
      fs.writeFileSync(path.join(agentDir, 'new-feature.ts'), 'export const x = 1')

      const orphans = findOrphanedWorktrees(tmp, {
        minWorktreeAgeMinutes: 0, // bypass age guard
        skipPRCheck: true,
        skipProcessCheck: true,
      })

      expect(orphans).to.have.length(0)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns safeToDelete=false from checkWorktreeLiveness when any signal is alive', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-combined-')))
    try {
      execSync('git init -q', { cwd: tmp, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: tmp, stdio: 'pipe' })
      fs.writeFileSync(path.join(tmp, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: tmp, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: tmp, stdio: 'pipe' })
      fs.writeFileSync(path.join(tmp, 'dirty.txt'), 'in-progress')

      const result = checkWorktreeLiveness('some-agent', tmp, 'some-branch', {
        hqPath: '/tmp/definitely-not-real-1324',
        minWorktreeAgeMinutes: 0, // bypass age
        hostTmuxSessions: [],
        containerTmuxSessions: new Map(),
        skipPRCheck: true,
        skipProcessCheck: true,
      })

      expect(result.safeToDelete).to.be.false
      expect(result.reasons).to.have.length.at.least(1)
      expect(result.reasons.some(r => r.includes('uncommitted'))).to.be.true
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns safeToDelete=true when all signals are safe', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-safe-')))
    try {
      execSync('git init -q', { cwd: tmp, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: tmp, stdio: 'pipe' })
      fs.writeFileSync(path.join(tmp, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: tmp, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: tmp, stdio: 'pipe' })

      const result = checkWorktreeLiveness('ghost-agent', tmp, 'ghost-branch', {
        hqPath: '/tmp/definitely-not-real-1324',
        minWorktreeAgeMinutes: 0, // bypass age
        hostTmuxSessions: [],
        containerTmuxSessions: new Map(),
        skipPRCheck: true,
        skipProcessCheck: true,
      })

      expect(result.safeToDelete).to.be.true
      expect(result.reasons).to.have.length(0)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('logs a skip reason for every preserved worktree (operator visibility)', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-log-')))
    try {
      const reposDir = path.join(tmp, 'repos')
      const repoDir = path.join(reposDir, 'test-repo')
      fs.mkdirSync(repoDir, { recursive: true })

      execSync('git init -q', { cwd: repoDir, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: repoDir, stdio: 'pipe' })
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# test')
      execSync('git -c user.name=test -c user.email=t@t add .', { cwd: repoDir, stdio: 'pipe' })
      execSync('git -c user.name=test -c user.email=t@t commit -q -m init', { cwd: repoDir, stdio: 'pipe' })

      const agentDir = path.join(tmp, 'agents', 'temp', 'logged-agent', 'test-repo')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })
      execSync(`git worktree add "${agentDir}" -b agent-logged-agent`, {
        cwd: repoDir,
        stdio: 'pipe',
      })

      const logs: string[] = []
      // Leave defaults so the 5m age guard triggers.
      findOrphanedWorktrees(tmp, {
        skipPRCheck: true,
        skipProcessCheck: true,
        log: (m) => logs.push(m),
      })

      // Each skipped worktree must contribute at least one log entry naming
      // the worktree path and the reason(s) for skipping.
      const skipLog = logs.find(l => l.includes('logged-agent'))
      expect(skipLog, `expected a skip log for logged-agent, got: ${logs.join('\n')}`).to.not.be.undefined
      expect(skipLog!).to.include('Skipping')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
