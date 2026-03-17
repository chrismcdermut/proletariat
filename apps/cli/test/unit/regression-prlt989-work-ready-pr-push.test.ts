/**
 * Regression test for PRLT-989: work ready --pr skips PR creation
 *
 * Bug: `work ready --pr` would skip PR creation when the branch was already
 * pushed to the remote. If `pushBranch()` failed (e.g. race condition,
 * already up-to-date), the command would log "Failed to push branch.
 * Skipping PR creation." and abort.
 *
 * Fix (PR #832): After a push failure, re-check if the branch exists on
 * remote before giving up. For already-pushed branches with push failures,
 * continue with PR creation instead of aborting.
 *
 * This test verifies the git utility functions used by handlePRCreation,
 * specifically the push/check flow that the fix relies on.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  hasBranchBeenPushed,
  pushBranch,
  hasUnpushedCommits,
  getCurrentBranch,
} from '../../src/lib/pr/index.js'

/**
 * Create a test git repo with a bare remote and a working clone.
 * Returns paths and a cleanup function.
 */
function createTestGitRepo(): {
  bareDir: string
  repoDir: string
  cleanup: () => void
} {
  const bareDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt989-bare-')))
  const repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt989-clone-')))

  execSync('git init --bare --initial-branch=main', { cwd: bareDir, stdio: 'pipe' })
  execSync(`git clone "${bareDir}" .`, { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })

  // Create initial commit on main
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test')
  execSync('git add . && git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git push origin main', { cwd: repoDir, stdio: 'pipe' })

  return {
    bareDir,
    repoDir,
    cleanup: () => {
      if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true })
      if (fs.existsSync(bareDir)) fs.rmSync(bareDir, { recursive: true, force: true })
    },
  }
}

describe('Regression: PRLT-989 — work ready --pr should not skip PR creation', () => {
  let bareDir: string
  let repoDir: string
  let cleanup: () => void

  beforeEach(() => {
    const repo = createTestGitRepo()
    bareDir = repo.bareDir
    repoDir = repo.repoDir
    cleanup = repo.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  it('hasBranchBeenPushed returns true after branch is pushed', () => {
    // Create and push a feature branch
    execSync('git checkout -b feature/test-branch', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature work')
    execSync('git add . && git commit -m "feature commit"', { cwd: repoDir, stdio: 'pipe' })
    execSync('git push -u origin feature/test-branch', { cwd: repoDir, stdio: 'pipe' })

    expect(hasBranchBeenPushed('feature/test-branch', repoDir)).to.be.true
  })

  it('hasBranchBeenPushed returns false for unpushed branch', () => {
    execSync('git checkout -b feature/unpushed', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'unpushed.txt'), 'unpushed')
    execSync('git add . && git commit -m "unpushed commit"', { cwd: repoDir, stdio: 'pipe' })

    expect(hasBranchBeenPushed('feature/unpushed', repoDir)).to.be.false
  })

  it('pushBranch returns true on successful push', () => {
    execSync('git checkout -b feature/push-test', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'push.txt'), 'push test')
    execSync('git add . && git commit -m "push commit"', { cwd: repoDir, stdio: 'pipe' })

    expect(pushBranch('feature/push-test', repoDir)).to.be.true
    expect(hasBranchBeenPushed('feature/push-test', repoDir)).to.be.true
  })

  it('hasUnpushedCommits returns false when all commits are pushed', () => {
    execSync('git checkout -b feature/pushed-all', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'all.txt'), 'all pushed')
    execSync('git add . && git commit -m "pushed commit"', { cwd: repoDir, stdio: 'pipe' })
    execSync('git push -u origin feature/pushed-all', { cwd: repoDir, stdio: 'pipe' })

    expect(hasUnpushedCommits('feature/pushed-all', repoDir)).to.be.false
  })

  it('hasUnpushedCommits returns true when there are local commits not on remote', () => {
    execSync('git checkout -b feature/partial-push', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'first.txt'), 'first')
    execSync('git add . && git commit -m "first commit"', { cwd: repoDir, stdio: 'pipe' })
    execSync('git push -u origin feature/partial-push', { cwd: repoDir, stdio: 'pipe' })

    // Add another commit without pushing
    fs.writeFileSync(path.join(repoDir, 'second.txt'), 'second')
    execSync('git add . && git commit -m "second commit"', { cwd: repoDir, stdio: 'pipe' })

    expect(hasUnpushedCommits('feature/partial-push', repoDir)).to.be.true
  })

  /**
   * Core regression test for PRLT-989:
   *
   * Simulate the race condition where a branch was pushed by another process.
   * The fix's logic is:
   *   1. if !hasBranchBeenPushed → try push
   *   2. if push fails → re-check hasBranchBeenPushed
   *   3. if branch now exists on remote → continue (don't abort)
   *
   * We simulate this by pushing the branch from a second clone (concurrent process),
   * then verifying hasBranchBeenPushed detects it.
   */
  it('hasBranchBeenPushed detects branch pushed by another process (race condition fix)', () => {
    // Create a feature branch in the first clone
    execSync('git checkout -b feature/race-test', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'race.txt'), 'race content')
    execSync('git add . && git commit -m "race commit"', { cwd: repoDir, stdio: 'pipe' })

    // Initially, branch is NOT on remote
    expect(hasBranchBeenPushed('feature/race-test', repoDir)).to.be.false

    // Simulate another process pushing the same branch:
    // Create a second clone and push the branch from there
    const secondClone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt989-clone2-')))
    try {
      execSync(`git clone "${bareDir}" .`, { cwd: secondClone, stdio: 'pipe' })
      execSync('git config user.email "test@test.com"', { cwd: secondClone, stdio: 'pipe' })
      execSync('git config user.name "Test"', { cwd: secondClone, stdio: 'pipe' })
      execSync('git checkout -b feature/race-test', { cwd: secondClone, stdio: 'pipe' })
      fs.writeFileSync(path.join(secondClone, 'race.txt'), 'race content from clone2')
      execSync('git add . && git commit -m "race commit from clone2"', { cwd: secondClone, stdio: 'pipe' })
      execSync('git push -u origin feature/race-test', { cwd: secondClone, stdio: 'pipe' })
    } finally {
      fs.rmSync(secondClone, { recursive: true, force: true })
    }

    // Fetch from origin so the first clone knows about the remote branch
    execSync('git fetch origin', { cwd: repoDir, stdio: 'pipe' })

    // Now hasBranchBeenPushed should return true (the fix's re-check logic)
    expect(hasBranchBeenPushed('feature/race-test', repoDir)).to.be.true
  })

  /**
   * Second regression scenario for PRLT-989:
   *
   * Branch is already pushed, but pushBranch fails because there's nothing
   * new to push (already up-to-date). The fix ensures we don't abort
   * PR creation in this case — we check that the branch exists on remote
   * and continue.
   */
  it('branch already pushed — push of same content is a no-op but branch stays on remote', () => {
    execSync('git checkout -b feature/already-pushed', { cwd: repoDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(repoDir, 'already.txt'), 'already pushed')
    execSync('git add . && git commit -m "already pushed commit"', { cwd: repoDir, stdio: 'pipe' })
    execSync('git push -u origin feature/already-pushed', { cwd: repoDir, stdio: 'pipe' })

    // Branch is on remote
    expect(hasBranchBeenPushed('feature/already-pushed', repoDir)).to.be.true

    // Push again — should succeed (no-op push)
    const secondPush = pushBranch('feature/already-pushed', repoDir)
    expect(secondPush).to.be.true

    // Branch is still on remote (the key invariant the fix relies on)
    expect(hasBranchBeenPushed('feature/already-pushed', repoDir)).to.be.true

    // No unpushed commits
    expect(hasUnpushedCommits('feature/already-pushed', repoDir)).to.be.false
  })

  it('getCurrentBranch returns the correct branch name', () => {
    execSync('git checkout -b feature/current-branch-test', { cwd: repoDir, stdio: 'pipe' })
    expect(getCurrentBranch(repoDir)).to.equal('feature/current-branch-test')
  })
})
