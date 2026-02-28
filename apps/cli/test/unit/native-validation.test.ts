import { expect } from 'chai'
import {
  buildBetterSqlite3ValidationMessage,
  validateBetterSqlite3NativeBinding,
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
      },
      'unit-test'
    )

    expect(message).to.include('better-sqlite3 native module validation failed (unit-test).')
    expect(message).to.include('node v22.8.0 (ABI 127) on darwin-arm64')
    expect(message).to.include('npm rebuild better-sqlite3')
    expect(message).to.include('npm uninstall -g @proletariat/cli && npm install -g @proletariat/cli')
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
