import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  checkTapStaleness,
} from '../../src/lib/brew-tap-check.js'

describe('Brew Tap Check', () => {
  let testDir: string
  let tapDir: string

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brew-tap-test-')))
    tapDir = path.join(testDir, 'tap-repo')
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * Create a bare git repo to act as the "remote" and a clone to act as the
   * local tap checkout. Returns { localPath, remotePath }.
   */
  function createTapRepoWithRemote(): { localPath: string; remotePath: string } {
    const remotePath = path.join(testDir, 'remote-repo')
    const localPath = path.join(testDir, 'local-tap')

    // Create a bare remote with main as default branch
    fs.mkdirSync(remotePath, { recursive: true })
    execSync('git init --bare --initial-branch=main', { cwd: remotePath, stdio: 'pipe' })

    // Clone it as the local tap
    execSync(`git clone "${remotePath}" "${localPath}"`, { stdio: 'pipe' })

    // Configure git user for commits in the test repo
    execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: localPath, stdio: 'pipe' })

    // Make an initial commit in the local clone and push it
    const dummyFile = path.join(localPath, 'Formula', 'prlt.rb')
    fs.mkdirSync(path.join(localPath, 'Formula'), { recursive: true })
    fs.writeFileSync(dummyFile, 'class Prlt < Formula; end', 'utf-8')
    execSync('git add -A && git commit -m "initial"', { cwd: localPath, stdio: 'pipe' })
    execSync('git push origin main', { cwd: localPath, stdio: 'pipe' })

    return { localPath, remotePath }
  }

  describe('checkTapStaleness', () => {
    it('returns healthy when tapPath is null', () => {
      const result = checkTapStaleness(null)
      expect(result.isStale).to.be.false
      expect(result.message).to.equal('')
      expect(result.remediationCommands).to.have.lengthOf(0)
    })

    it('returns healthy when tapPath does not exist', () => {
      const result = checkTapStaleness('/nonexistent/path')
      expect(result.isStale).to.be.false
    })

    it('returns healthy when local HEAD matches remote HEAD', () => {
      const { localPath } = createTapRepoWithRemote()
      const result = checkTapStaleness(localPath)
      expect(result.isStale).to.be.false
      expect(result.message).to.equal('')
      expect(result.remediationCommands).to.have.lengthOf(0)
    })

    it('returns stale when local HEAD is behind remote HEAD', () => {
      const { localPath, remotePath } = createTapRepoWithRemote()

      // Push a new commit to the remote (bypassing the local clone)
      // Create a temporary clone, commit, and push
      const tmpClone = path.join(testDir, 'tmp-clone')
      execSync(`git clone "${remotePath}" "${tmpClone}"`, { stdio: 'pipe' })
      execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: tmpClone, stdio: 'pipe' })
      const newFile = path.join(tmpClone, 'Formula', 'prlt.rb')
      fs.writeFileSync(newFile, 'class Prlt < Formula; version "0.4.0"; end', 'utf-8')
      execSync('git add -A && git commit -m "bump version"', { cwd: tmpClone, stdio: 'pipe' })
      execSync('git push origin main', { cwd: tmpClone, stdio: 'pipe' })

      // Now local tap is behind remote
      const result = checkTapStaleness(localPath)
      expect(result.isStale).to.be.true
      expect(result.message).to.include('out of date')
      expect(result.remediationCommands.length).to.be.greaterThan(0)
      expect(result.remediationCommands.some(cmd => cmd.includes('brew'))).to.be.true
    })

    it('includes copy-paste remediation commands when stale', () => {
      const { localPath, remotePath } = createTapRepoWithRemote()

      // Push a new commit to the remote
      const tmpClone = path.join(testDir, 'tmp-clone-2')
      execSync(`git clone "${remotePath}" "${tmpClone}"`, { stdio: 'pipe' })
      execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: tmpClone, stdio: 'pipe' })
      fs.writeFileSync(path.join(tmpClone, 'new-file'), 'data', 'utf-8')
      execSync('git add -A && git commit -m "add file"', { cwd: tmpClone, stdio: 'pipe' })
      execSync('git push origin main', { cwd: tmpClone, stdio: 'pipe' })

      const result = checkTapStaleness(localPath)
      expect(result.isStale).to.be.true

      // Should include tap repair and upgrade commands
      expect(result.remediationCommands).to.include('brew tap --repair chrismcdermut/proletariat')
      expect(result.remediationCommands).to.include('brew update')
      expect(result.remediationCommands).to.include('brew upgrade chrismcdermut/proletariat/prlt')
    })

    it('returns healthy when tapPath is not a git repo', () => {
      // Create a plain directory (no git init)
      fs.mkdirSync(tapDir, { recursive: true })
      const result = checkTapStaleness(tapDir)
      expect(result.isStale).to.be.false
    })
  })
})
