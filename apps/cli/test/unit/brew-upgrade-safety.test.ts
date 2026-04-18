import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  refreshBrewTap,
  verifyBrewBinaryExists,
  runBrewUpgradeWithSafety,
} from '../../src/lib/update-check.js'

// ---------------------------------------------------------------------------
// PRLT-1344: brew upgrade safety
//
// These tests verify that:
// 1. refreshBrewTap() refreshes the tap before upgrade (AC #1)
// 2. verifyBrewBinaryExists() detects missing binary after upgrade (AC #2, #4)
// 3. runBrewUpgradeWithSafety() orchestrates tap refresh, upgrade, and recovery (AC #1, #2, #4)
// 4. detectPackageManager + getUpdateCommand already handles AC #3 (tested in update-check.test.ts)
// ---------------------------------------------------------------------------

/**
 * Minimal system PATH that includes basic system commands (which, bash, rm, etc.)
 * but NOT real brew or prlt installations.
 */
const SYSTEM_ONLY_PATH = '/usr/bin:/bin'

describe('Brew upgrade safety (PRLT-1344)', () => {
  let originalLog: typeof console.log
  let originalError: typeof console.error
  let logs: string[]
  let errors: string[]

  beforeEach(() => {
    logs = []
    errors = []
    originalLog = console.log
    originalError = console.error
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
  })

  // =========================================================================
  // refreshBrewTap
  // =========================================================================
  describe('refreshBrewTap', () => {
    it('returns a boolean and does not throw', () => {
      // In CI or environments without brew, this returns false gracefully.
      // On developer machines with brew, this returns true.
      const result = refreshBrewTap()
      expect(result).to.be.a('boolean')
    })

    it('returns false when brew is not available', () => {
      // Save original PATH
      const originalPath = process.env.PATH
      try {
        // Set PATH to empty so brew can't be found
        process.env.PATH = ''
        const result = refreshBrewTap()
        expect(result).to.be.false
      } finally {
        process.env.PATH = originalPath
      }
    })
  })

  // =========================================================================
  // verifyBrewBinaryExists
  // =========================================================================
  describe('verifyBrewBinaryExists', () => {
    it('returns a boolean and does not throw', () => {
      const result = verifyBrewBinaryExists()
      expect(result).to.be.a('boolean')
    })

    it('returns false when PATH is empty (no binary found)', () => {
      const originalPath = process.env.PATH
      try {
        process.env.PATH = '/nonexistent-path-that-has-no-binaries'
        const result = verifyBrewBinaryExists()
        expect(result).to.be.false
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('returns true when a real prlt binary exists on PATH', () => {
      // Create a temp dir with a fake "prlt" binary and put it on PATH
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-verify-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.writeFileSync(fakeBin, '#!/bin/bash\necho "fake prlt"')
      fs.chmodSync(fakeBin, '755')

      const originalPath = process.env.PATH
      try {
        process.env.PATH = `${tmpDir}:${originalPath}`
        const result = verifyBrewBinaryExists()
        expect(result).to.be.true
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('returns false when which finds a path but file does not exist (dangling symlink)', () => {
      // Create a temp dir with a dangling symlink named "prlt"
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-verify-dangle-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.symlinkSync('/nonexistent-target-for-prlt-test', fakeBin)

      const originalPath = process.env.PATH
      try {
        // Use only the temp dir + system commands — no real prlt on PATH
        process.env.PATH = `${tmpDir}:${SYSTEM_ONLY_PATH}`
        const result = verifyBrewBinaryExists()
        expect(result).to.be.false
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  // =========================================================================
  // runBrewUpgradeWithSafety
  // =========================================================================
  describe('runBrewUpgradeWithSafety', () => {
    it('logs tap refresh message before attempting upgrade', () => {
      const originalPath = process.env.PATH
      try {
        // Ensure no real brew runs — use system-only PATH
        process.env.PATH = SYSTEM_ONLY_PATH
        try {
          runBrewUpgradeWithSafety()
        } catch {
          // Expected to fail without brew
        }

        const output = logs.join('\n')
        expect(output).to.include('Refreshing Homebrew tap')
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('throws with clear reinstall instructions when brew is unavailable', () => {
      const originalPath = process.env.PATH
      try {
        // Remove brew from PATH
        process.env.PATH = '/nonexistent-path-only'
        let thrownError: Error | null = null
        try {
          runBrewUpgradeWithSafety()
        } catch (err) {
          thrownError = err as Error
        }
        expect(thrownError).to.not.be.null
        // The error message should contain reinstall instructions
        const errorMsg = thrownError!.message
        expect(errorMsg).to.include('brew')
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('attempts recovery when binary is missing after upgrade failure', () => {
      // Set PATH so no brew is available — this simulates the worst case
      // where upgrade fails and binary is not found
      const originalPath = process.env.PATH
      try {
        process.env.PATH = '/nonexistent-path-only'
        try {
          runBrewUpgradeWithSafety()
        } catch {
          // Expected
        }
        // Should have attempted recovery (logged error about missing binary)
        const errorOutput = errors.join('\n')
        expect(errorOutput).to.include('removed prlt without installing')
      } finally {
        process.env.PATH = originalPath
      }
    })

    it('does not throw when upgrade exits non-zero but binary is still present', () => {
      // Create a fake "prlt" on PATH so verifyBrewBinaryExists returns true
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-brew-safe-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.writeFileSync(fakeBin, '#!/bin/bash\necho "fake prlt"')
      fs.chmodSync(fakeBin, '755')

      // Also create a fake "brew" that fails on upgrade but succeeds on tap
      const fakeBrew = path.join(tmpDir, 'brew')
      fs.writeFileSync(fakeBrew, [
        '#!/bin/bash',
        'if [[ "$1" == "tap" ]]; then exit 0; fi',
        'if [[ "$1" == "upgrade" ]]; then',
        '  echo "Error: already installed" >&2',
        '  exit 1',
        'fi',
        'exit 1',
      ].join('\n'))
      fs.chmodSync(fakeBrew, '755')

      const originalPath = process.env.PATH
      try {
        // Use only tmpDir + system commands to avoid real brew
        process.env.PATH = `${tmpDir}:${SYSTEM_ONLY_PATH}`

        // Should throw because brew upgrade failed, but prlt is still there
        let thrownError: Error | null = null
        try {
          runBrewUpgradeWithSafety()
        } catch (err) {
          thrownError = err as Error
        }
        // It should throw with a message about the error, but binary is fine
        expect(thrownError).to.not.be.null
        expect(thrownError!.message).to.include('brew upgrade exited with an error')
        expect(thrownError!.message).to.include('prlt is still installed')
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('succeeds when brew tap and upgrade both succeed and binary exists', () => {
      // Create a temp dir with fake brew and prlt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-brew-ok-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.writeFileSync(fakeBin, '#!/bin/bash\necho "fake prlt"')
      fs.chmodSync(fakeBin, '755')

      const fakeBrew = path.join(tmpDir, 'brew')
      fs.writeFileSync(fakeBrew, [
        '#!/bin/bash',
        '# Fake brew that succeeds for both tap and upgrade',
        'exit 0',
      ].join('\n'))
      fs.chmodSync(fakeBrew, '755')

      const originalPath = process.env.PATH
      try {
        // Use only tmpDir + system commands to avoid real brew
        process.env.PATH = `${tmpDir}:${SYSTEM_ONLY_PATH}`
        expect(() => runBrewUpgradeWithSafety()).to.not.throw()
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('attempts brew reinstall when upgrade removes binary', () => {
      // Create a temp dir with fake brew and prlt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-brew-reinstall-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.writeFileSync(fakeBin, '#!/bin/bash\necho "fake prlt"')
      fs.chmodSync(fakeBin, '755')

      // Fake brew: tap succeeds, upgrade removes prlt, reinstall puts it back
      const fakeBrew = path.join(tmpDir, 'brew')
      fs.writeFileSync(fakeBrew, [
        '#!/bin/bash',
        `if [[ "$1" == "tap" ]]; then exit 0; fi`,
        `if [[ "$1" == "upgrade" ]]; then`,
        `  rm -f "${fakeBin}"`,
        `  exit 0`,
        `fi`,
        `if [[ "$1" == "reinstall" ]]; then`,
        `  echo '#!/bin/bash' > "${fakeBin}"`,
        `  echo 'echo reinstalled' >> "${fakeBin}"`,
        `  chmod 755 "${fakeBin}"`,
        `  exit 0`,
        `fi`,
        `exit 1`,
      ].join('\n'))
      fs.chmodSync(fakeBrew, '755')

      const originalPath = process.env.PATH
      try {
        // Use only tmpDir + system commands so no real prlt interferes
        process.env.PATH = `${tmpDir}:${SYSTEM_ONLY_PATH}`
        // Should not throw because reinstall recovers the binary
        expect(() => runBrewUpgradeWithSafety()).to.not.throw()

        // Verify recovery messages were logged
        const errorOutput = errors.join('\n')
        expect(errorOutput).to.include('removed prlt without installing')
        expect(errorOutput).to.include('Attempting to reinstall')

        // Verify recovery success message
        const logOutput = logs.join('\n')
        expect(logOutput).to.include('Recovery succeeded')
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('throws with instructions when both upgrade and reinstall fail to provide binary', () => {
      // Create a temp dir with fake brew that always removes prlt
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-brew-fatal-'))
      const fakeBin = path.join(tmpDir, 'prlt')
      fs.writeFileSync(fakeBin, '#!/bin/bash\necho "fake prlt"')
      fs.chmodSync(fakeBin, '755')

      // Fake brew: tap succeeds, upgrade removes prlt, reinstall also fails
      const fakeBrew = path.join(tmpDir, 'brew')
      fs.writeFileSync(fakeBrew, [
        '#!/bin/bash',
        `if [[ "$1" == "tap" ]]; then exit 0; fi`,
        `if [[ "$1" == "upgrade" ]]; then`,
        `  rm -f "${fakeBin}"`,
        `  exit 0`,
        `fi`,
        `if [[ "$1" == "reinstall" ]]; then`,
        `  exit 1`,
        `fi`,
        `exit 1`,
      ].join('\n'))
      fs.chmodSync(fakeBrew, '755')

      const originalPath = process.env.PATH
      try {
        // Use only tmpDir + system commands so no real prlt interferes
        process.env.PATH = `${tmpDir}:${SYSTEM_ONLY_PATH}`
        let thrownError: Error | null = null
        try {
          runBrewUpgradeWithSafety()
        } catch (err) {
          thrownError = err as Error
        }
        expect(thrownError).to.not.be.null
        expect(thrownError!.message).to.include('automatic recovery failed')
        expect(thrownError!.message).to.include('brew tap --force')
        expect(thrownError!.message).to.include('brew install chrismcdermut/proletariat/prlt')
      } finally {
        process.env.PATH = originalPath
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })
})
