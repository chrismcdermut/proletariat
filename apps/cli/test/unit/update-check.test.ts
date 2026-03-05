import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  readCache,
  writeCache,
  shouldCheck,
  isNewerVersion,
  getCachedUpdateInfo,
  dismissVersion,
  detectPackageManager,
  getUpdateCommand,
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

    it('returns true when last check was more than 20 hours ago', () => {
      const twentyOneHoursAgo = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString()
      expect(shouldCheck({
        latest_version: '1.0.0',
        last_checked_at: twentyOneHoursAgo,
        dismissed_version: null,
      })).to.be.true
    })

    it('returns false when last check was less than 20 hours ago', () => {
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
  })
})
