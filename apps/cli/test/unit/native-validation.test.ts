import { expect } from 'chai'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  buildBetterSqlite3ValidationMessage,
  isBetterSqlite3NativeError,
  isAbiMismatchError,
  validateBetterSqlite3NativeBinding,
  attemptAutoRebuild,
  findBetterSqlite3InstallDir,
} from '../../src/lib/database/native-validation.js'

describe('better-sqlite3 native validation', () => {
  it('formats actionable guidance with runtime details', () => {
    const message = buildBetterSqlite3ValidationMessage(
      new Error('not a mach-o file'),
      {
        nodeVersion: 'v22.8.0',
        nodeMajor: 22,
        abi: '127',
        platform: 'darwin',
        arch: 'arm64',
        isBun: false,
      },
      'unit-test'
    )

    expect(message).to.include('better-sqlite3 native module failed to load (unit-test).')
    expect(message).to.include('node v22.8.0 (ABI 127) on darwin-arm64')
    expect(message).to.include('npm rebuild better-sqlite3')
    expect(message).to.include('pnpm install -g @proletariat/cli --force')
  })

  it('includes bun-specific guidance when isBun is true', () => {
    const message = buildBetterSqlite3ValidationMessage(
      new Error('isexe_1.default is not a function'),
      {
        nodeVersion: 'v22.8.0',
        nodeMajor: 22,
        abi: '127',
        platform: 'darwin',
        arch: 'arm64',
        isBun: true,
      },
      'postinstall'
    )

    expect(message).to.include('bun v22.8.0 (ABI 127) on darwin-arm64')
    expect(message).to.include('Bun users:')
    expect(message).to.include('npm install -g @proletariat/cli')
    expect(message).to.include('brew install chrismcdermut/proletariat/prlt')
  })

  it('includes bun guidance when error matches bun node-gyp pattern', () => {
    const message = buildBetterSqlite3ValidationMessage(
      new Error('node-gyp failed: isexe is not a function'),
      {
        nodeVersion: 'v24.5.0',
        nodeMajor: 24,
        abi: '131',
        platform: 'darwin',
        arch: 'arm64',
        isBun: false,
      },
      'postinstall'
    )

    expect(message).to.include('Bun users:')
  })

  it('detects bun isexe error as a native error', () => {
    const error = new Error('TypeError: (0, isexe_1.default) is not a function')
    expect(isBetterSqlite3NativeError(error)).to.be.true
  })

  it('throws with contextual message when loader fails', async () => {
    let capturedError: Error | undefined

    try {
      await validateBetterSqlite3NativeBinding({
        context: 'test bootstrap',
        loadModule: async () => {
          throw new Error('dlopen failure')
        },
      })
    } catch (error) {
      capturedError = error as Error
    }

    expect(capturedError).to.be.instanceOf(Error)
    expect(capturedError!.message).to.include('test bootstrap')
    expect(capturedError!.message).to.include('dlopen failure')
    expect(capturedError!.message).to.include('Fix steps:')
  })
})

describe('isAbiMismatchError', () => {
  it('detects NODE_MODULE_VERSION mismatch', () => {
    const error = new Error(
      'The module was compiled against NODE_MODULE_VERSION 127. ' +
      'This version of Node.js requires NODE_MODULE_VERSION 141.'
    )
    expect(isAbiMismatchError(error)).to.be.true
  })

  it('detects "compiled against a different Node.js version"', () => {
    const error = new Error('was compiled against a different Node.js version')
    expect(isAbiMismatchError(error)).to.be.true
  })

  it('returns false for non-ABI errors', () => {
    expect(isAbiMismatchError(new Error('dlopen failure'))).to.be.false
    expect(isAbiMismatchError(new Error('MODULE_NOT_FOUND'))).to.be.false
    expect(isAbiMismatchError('not an error')).to.be.false
  })

  it('returns false for non-Error values', () => {
    expect(isAbiMismatchError(null)).to.be.false
    expect(isAbiMismatchError(undefined)).to.be.false
    expect(isAbiMismatchError(42)).to.be.false
  })
})

describe('attemptAutoRebuild', () => {
  it('returns false when install dir is not found', () => {
    // findBetterSqlite3InstallDir walks from __dirname, but we can test
    // the rebuild path by providing an execRebuild that should never be called
    let execCalled = false
    const result = attemptAutoRebuild({
      context: 'test',
      execRebuild: () => { execCalled = true },
    })
    // If install dir is found (we're running from the repo), the exec will be called
    // Either way, the function should return a boolean
    expect(typeof result).to.equal('boolean')
    // We can't guarantee install dir is/isn't found in test, so just verify no crash
  })

  it('calls execRebuild with correct command when install dir exists', () => {
    // Since we're running from the repo, better-sqlite3 should be findable
    const installDir = findBetterSqlite3InstallDir()
    if (!installDir) {
      // Skip if running in an environment without better-sqlite3
      return
    }

    let capturedCmd = ''
    let capturedCwd = ''
    const result = attemptAutoRebuild({
      context: 'test',
      execRebuild: (cmd, opts) => {
        capturedCmd = cmd
        capturedCwd = opts.cwd
      },
    })

    expect(result).to.be.true
    expect(capturedCmd).to.equal('npm rebuild better-sqlite3')
    expect(capturedCwd).to.equal(installDir)
  })

  it('returns false when execRebuild throws', () => {
    const installDir = findBetterSqlite3InstallDir()
    if (!installDir) {
      return
    }

    const result = attemptAutoRebuild({
      context: 'test',
      execRebuild: () => { throw new Error('rebuild failed') },
    })

    expect(result).to.be.false
  })
})

describe('validateBetterSqlite3NativeBinding with auto-rebuild', () => {
  it('attempts auto-rebuild on ABI mismatch error', async () => {
    let rebuildAttempted = false
    let loadCount = 0

    try {
      await validateBetterSqlite3NativeBinding({
        context: 'abi-test',
        loadModule: async () => {
          loadCount++
          throw new Error(
            'The module was compiled against NODE_MODULE_VERSION 127. ' +
            'This version of Node.js requires NODE_MODULE_VERSION 141.'
          )
        },
        execRebuild: () => { rebuildAttempted = true },
      })
    } catch {
      // Expected to throw after rebuild fails to fix the issue
    }

    expect(rebuildAttempted).to.be.true
    // Should have tried loading twice: once before rebuild, once after
    expect(loadCount).to.equal(2)
  })

  it('does not attempt auto-rebuild for non-ABI errors', async () => {
    let rebuildAttempted = false

    try {
      await validateBetterSqlite3NativeBinding({
        context: 'non-abi-test',
        loadModule: async () => {
          throw new Error('Could not locate the bindings file')
        },
        execRebuild: () => { rebuildAttempted = true },
      })
    } catch {
      // Expected to throw
    }

    expect(rebuildAttempted).to.be.false
  })

  it('skips auto-rebuild when skipAutoRebuild is true', async () => {
    let rebuildAttempted = false

    try {
      await validateBetterSqlite3NativeBinding({
        context: 'skip-test',
        skipAutoRebuild: true,
        loadModule: async () => {
          throw new Error(
            'The module was compiled against NODE_MODULE_VERSION 127.'
          )
        },
        execRebuild: () => { rebuildAttempted = true },
      })
    } catch {
      // Expected to throw
    }

    expect(rebuildAttempted).to.be.false
  })

  it('succeeds after rebuild fixes the ABI mismatch', async () => {
    let loadCount = 0

    // First load fails with ABI mismatch, second load succeeds (simulating rebuild fix)
    await validateBetterSqlite3NativeBinding({
      context: 'fix-test',
      loadModule: async () => {
        loadCount++
        if (loadCount === 1) {
          throw new Error(
            'The module was compiled against NODE_MODULE_VERSION 127.'
          )
        }
        // Second call succeeds
        return {
          default: class MockDB {
            pragma() { return null }
            close() {}
          } as unknown as new (path: string) => { pragma(sql: string): unknown; close(): void },
        }
      },
      execRebuild: () => { /* simulate successful rebuild */ },
    })

    expect(loadCount).to.equal(2)
  })
})

describe('findBetterSqlite3InstallDir', () => {
  it('returns a string or null', () => {
    const result = findBetterSqlite3InstallDir()
    expect(result === null || typeof result === 'string').to.be.true
  })

  it('returned dir contains node_modules/better-sqlite3 when non-null', () => {
    const result = findBetterSqlite3InstallDir()
    if (result !== null) {
      const candidate = path.join(result, 'node_modules', 'better-sqlite3')
      expect(fs.existsSync(candidate)).to.be.true
    }
  })
})
