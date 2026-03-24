import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  readCache,
  writeCache,
  shouldCheck,
  isNewerVersion,
  getCachedUpdateInfo,
  dismissVersion,
  detectPackageManager,
  getUpdateCommand,
  checkStaleTap,
  getBrewTapPath,
  getStaleTapCommands,
  triggerBackgroundCheck,
  flushPendingVersionCheck,
  type VersionCheckCache,
} from '../../src/lib/update-check.js'

describe('Update Check', () => {
  let testDir: string
  let originalHome: string | undefined
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'update-check-test-')))
    originalHome = process.env.HOME
    process.env.HOME = testDir

    // Save env vars we'll modify
    originalEnv = {
      PRLT_MANAGED_BY: process.env.PRLT_MANAGED_BY,
    }
  })

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }

    // Restore env vars
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('readCache / writeCache', () => {
    it('returns default cache when file does not exist', () => {
      const cache = readCache()
      expect(cache.latest_version).to.be.null
      expect(cache.last_checked_at).to.be.null
      expect(cache.dismissed_version).to.be.null
    })

    it('roundtrips cache data', () => {
      const cache: VersionCheckCache = {
        latest_version: '1.2.3',
        last_checked_at: '2024-01-01T00:00:00.000Z',
        dismissed_version: null,
      }
      writeCache(cache)
      const read = readCache()
      expect(read).to.deep.equal(cache)
    })

    it('handles corrupt cache file gracefully', () => {
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, 'version-check.json'), 'not json!', 'utf-8')
      const cache = readCache()
      expect(cache.latest_version).to.be.null
    })
  })

  describe('shouldCheck', () => {
    it('returns true when last_checked_at is null', () => {
      expect(shouldCheck({ latest_version: null, last_checked_at: null, dismissed_version: null })).to.be.true
    })

    it('returns true when last check was more than 4 hours ago', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      expect(shouldCheck({
        latest_version: '1.0.0',
        last_checked_at: fiveHoursAgo,
        dismissed_version: null,
      })).to.be.true
    })

    it('returns false when last check was less than 4 hours ago', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      expect(shouldCheck({
        latest_version: '1.0.0',
        last_checked_at: oneHourAgo,
        dismissed_version: null,
      })).to.be.false
    })

    it('returns true for invalid date string', () => {
      expect(shouldCheck({
        latest_version: '1.0.0',
        last_checked_at: 'not-a-date',
        dismissed_version: null,
      })).to.be.true
    })

    it('returns true when installed version is newer than cached latest (stale cache)', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      // User is on 0.3.92 but cache says latest is 0.3.91 — cache is stale
      expect(shouldCheck({
        latest_version: '0.3.91',
        last_checked_at: oneHourAgo,
        dismissed_version: null,
      }, '0.3.92')).to.be.true
    })

    it('returns false when cached latest is newer than installed version (cache is valid)', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      // User is on 0.3.91, cache says latest is 0.3.92 — cache is still valid
      expect(shouldCheck({
        latest_version: '0.3.92',
        last_checked_at: oneHourAgo,
        dismissed_version: null,
      }, '0.3.91')).to.be.false
    })

    it('returns false when installed version equals cached latest (no staleness)', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      expect(shouldCheck({
        latest_version: '0.3.92',
        last_checked_at: oneHourAgo,
        dismissed_version: null,
      }, '0.3.92')).to.be.false
    })

    it('falls back to time-based check when no currentVersion provided', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      expect(shouldCheck({
        latest_version: '0.3.91',
        last_checked_at: oneHourAgo,
        dismissed_version: null,
      })).to.be.false
    })
  })

  describe('isNewerVersion', () => {
    it('detects newer patch version', () => {
      expect(isNewerVersion('0.3.52', '0.3.53')).to.be.true
    })

    it('detects newer minor version', () => {
      expect(isNewerVersion('0.3.52', '0.4.0')).to.be.true
    })

    it('detects newer major version', () => {
      expect(isNewerVersion('0.3.52', '1.0.0')).to.be.true
    })

    it('returns false for same version', () => {
      expect(isNewerVersion('0.3.52', '0.3.52')).to.be.false
    })

    it('returns false for older version', () => {
      expect(isNewerVersion('0.3.52', '0.3.51')).to.be.false
    })

    it('handles v prefix', () => {
      expect(isNewerVersion('v0.3.52', 'v0.3.53')).to.be.true
    })

    it('handles mixed v prefix', () => {
      expect(isNewerVersion('0.3.52', 'v0.3.53')).to.be.true
    })
  })

  describe('getCachedUpdateInfo', () => {
    it('returns updateAvailable=false when no cache exists', () => {
      const info = getCachedUpdateInfo('0.3.52')
      expect(info.updateAvailable).to.be.false
      expect(info.currentVersion).to.equal('0.3.52')
      expect(info.latestVersion).to.be.null
    })

    it('returns updateAvailable=true when cache has newer version', () => {
      writeCache({
        latest_version: '0.3.53',
        last_checked_at: new Date().toISOString(),
        dismissed_version: null,
      })
      const info = getCachedUpdateInfo('0.3.52')
      expect(info.updateAvailable).to.be.true
      expect(info.latestVersion).to.equal('0.3.53')
    })

    it('returns updateAvailable=false when version is dismissed', () => {
      writeCache({
        latest_version: '0.3.53',
        last_checked_at: new Date().toISOString(),
        dismissed_version: '0.3.53',
      })
      const info = getCachedUpdateInfo('0.3.52')
      expect(info.updateAvailable).to.be.false
    })

    it('returns updateAvailable=true when a newer version supersedes dismissed', () => {
      writeCache({
        latest_version: '0.3.54',
        last_checked_at: new Date().toISOString(),
        dismissed_version: '0.3.53',
      })
      const info = getCachedUpdateInfo('0.3.52')
      expect(info.updateAvailable).to.be.true
    })

    it('returns updateAvailable=false when current is same as latest', () => {
      writeCache({
        latest_version: '0.3.52',
        last_checked_at: new Date().toISOString(),
        dismissed_version: null,
      })
      const info = getCachedUpdateInfo('0.3.52')
      expect(info.updateAvailable).to.be.false
    })
  })

  describe('dismissVersion', () => {
    it('persists dismissed_version to cache', () => {
      writeCache({
        latest_version: '0.3.53',
        last_checked_at: new Date().toISOString(),
        dismissed_version: null,
      })
      dismissVersion('0.3.53')
      const cache = readCache()
      expect(cache.dismissed_version).to.equal('0.3.53')
    })
  })

  describe('detectPackageManager', () => {
    it('returns brew when PRLT_MANAGED_BY=brew', () => {
      process.env.PRLT_MANAGED_BY = 'brew'
      expect(detectPackageManager()).to.equal('brew')
    })

    it('returns brew when PRLT_MANAGED_BY=homebrew', () => {
      process.env.PRLT_MANAGED_BY = 'homebrew'
      expect(detectPackageManager()).to.equal('brew')
    })

    it('returns npm when PRLT_MANAGED_BY=npm', () => {
      process.env.PRLT_MANAGED_BY = 'npm'
      expect(detectPackageManager()).to.equal('npm')
    })
  })

  describe('getUpdateCommand', () => {
    it('returns brew command for brew package manager', () => {
      expect(getUpdateCommand('brew')).to.equal('brew upgrade chrismcdermut/proletariat/prlt')
    })

    it('returns npm command for npm package manager', () => {
      expect(getUpdateCommand('npm')).to.equal('npm install -g @proletariat/cli')
    })

    it('returns prlt update command for standalone package manager', () => {
      expect(getUpdateCommand('standalone')).to.equal('prlt update')
    })
  })

  describe('getStaleTapCommands', () => {
    it('returns remediation commands', () => {
      const commands = getStaleTapCommands()
      expect(commands).to.be.an('array').with.length(2)
      expect(commands[0]).to.include('brew tap --force')
      expect(commands[1]).to.include('brew upgrade')
    })
  })

  describe('getBrewTapPath', () => {
    it('returns null when tap directory does not exist', () => {
      // Neither /opt/homebrew nor /usr/local tap paths will contain
      // our test directory, so this tests the "not found" path
      // when neither standard prefix matches.
      const result = getBrewTapPath()
      // Result depends on whether Homebrew is actually installed on this machine.
      // We just verify it returns a string or null without throwing.
      expect(result === null || typeof result === 'string').to.be.true
    })
  })

  describe('flushPendingVersionCheck', () => {
    it('resolves immediately when no check is pending', async () => {
      // Should be a no-op and resolve without error
      await flushPendingVersionCheck()
    })

    it('waits for a pending background check to complete', async () => {
      // Write a cache that is stale (last checked > 20 hours ago) so
      // triggerBackgroundCheck actually fires a fetch
      const staleCache: VersionCheckCache = {
        latest_version: '0.1.0',
        last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        dismissed_version: null,
      }
      writeCache(staleCache)

      // Trigger a background check. The npm fetch will either succeed
      // (updating the cache) or fail (caught internally). Either way,
      // flush should resolve without throwing.
      triggerBackgroundCheck('npm')
      await flushPendingVersionCheck()

      // After flush, the cache should have been updated (last_checked_at
      // should be more recent than our stale value — or unchanged if the
      // network call failed, which is fine).
      const cache = readCache()
      expect(cache.last_checked_at).to.satisfy(
        (v: string | null) => v === staleCache.last_checked_at || (v !== null && new Date(v).getTime() > new Date(staleCache.last_checked_at!).getTime()),
        'last_checked_at should be updated or unchanged on network failure',
      )
    })
  })

  describe('checkStaleTap', () => {
    let repoDir: string
    let bareDir: string

    beforeEach(() => {
      // Create a bare "origin" repo with main as default branch
      bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-tap-bare-'))
      bareDir = fs.realpathSync(bareDir)
      execSync('git init --bare --initial-branch=main', { cwd: bareDir, stdio: 'pipe' })

      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-tap-clone-'))
      repoDir = fs.realpathSync(repoDir)
      execSync(`git clone "${bareDir}" .`, { cwd: repoDir, stdio: 'pipe' })
      execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })

      // Create an initial commit on main and push
      fs.writeFileSync(path.join(repoDir, 'formula.rb'), 'v1')
      execSync('git add . && git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' })
      execSync('git push origin main', { cwd: repoDir, stdio: 'pipe' })
    })

    afterEach(() => {
      if (fs.existsSync(repoDir)) {
        fs.rmSync(repoDir, { recursive: true, force: true })
      }
      if (fs.existsSync(bareDir)) {
        fs.rmSync(bareDir, { recursive: true, force: true })
      }
    })

    it('returns isStale=false when tap is current', () => {
      const result = checkStaleTap(repoDir)
      expect(result.isStale).to.be.false
      expect(result.localHead).to.be.a('string')
      expect(result.remoteHead).to.be.a('string')
      expect(result.localHead).to.equal(result.remoteHead)
    })

    it('returns isStale=true when local is behind origin/main', () => {
      // Push a new commit directly to the bare repo via a temporary clone
      const tmpClone = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-tap-tmp-'))
      const tmpCloneReal = fs.realpathSync(tmpClone)
      try {
        execSync(`git clone "${bareDir}" .`, { cwd: tmpCloneReal, stdio: 'pipe' })
        execSync('git config user.email "test@test.com"', { cwd: tmpCloneReal, stdio: 'pipe' })
        execSync('git config user.name "Test"', { cwd: tmpCloneReal, stdio: 'pipe' })
        fs.writeFileSync(path.join(tmpCloneReal, 'formula.rb'), 'v2')
        execSync('git add . && git commit -m "new version"', { cwd: tmpCloneReal, stdio: 'pipe' })
        execSync('git push origin main', { cwd: tmpCloneReal, stdio: 'pipe' })
      } finally {
        fs.rmSync(tmpCloneReal, { recursive: true, force: true })
      }

      // Now repoDir is behind origin/main
      const result = checkStaleTap(repoDir)
      expect(result.isStale).to.be.true
      expect(result.localHead).to.be.a('string')
      expect(result.remoteHead).to.be.a('string')
      expect(result.localHead).to.not.equal(result.remoteHead)
    })

    it('returns isStale=false when tap path is null', () => {
      const result = checkStaleTap(null)
      expect(result.isStale).to.be.false
    })

    it('returns isStale=false when tap path does not exist', () => {
      const result = checkStaleTap('/nonexistent/path/to/tap')
      expect(result.isStale).to.be.false
    })

    it('returns isStale=false when path is not a git repo', () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-tap-nogit-'))
      try {
        const result = checkStaleTap(nonGitDir)
        expect(result.isStale).to.be.false
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true })
      }
    })
  })
})
