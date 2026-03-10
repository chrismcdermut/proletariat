import { expect } from 'chai'
import {
  buildBetterSqlite3ValidationMessage,
  isBetterSqlite3NativeError,
  validateBetterSqlite3NativeBinding,
} from '../../src/lib/database/native-validation.js'

describe('@smoke better-sqlite3 native validation', () => {
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
