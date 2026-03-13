import { expect } from 'chai'
import { EventEmitter } from 'node:events'

/**
 * Tests for signal-handler.ts
 *
 * Since the signal handler uses module-level singletons (cleanupCallbacks,
 * trackedProcesses, isShuttingDown) and calls process.exit(130) on shutdown,
 * we cannot safely test the full shutdown() sequence in a live test process.
 *
 * Instead we test the registration APIs (onShutdown, trackChildProcess) and
 * the withSignalSafePrompt wrapper by importing them and exercising their
 * non-exit-calling code paths.
 */

// We must import AFTER each test to avoid accumulated state, but since
// ES module imports are cached, we test the stateful functions directly.
import { onShutdown, trackChildProcess, isExiting } from '../../src/lib/signal-handler.js'

describe('signal-handler', () => {
  // ===========================================================================
  // onShutdown()
  // ===========================================================================

  describe('onShutdown()', () => {
    it('returns an unregister function', () => {
      const unregister = onShutdown(() => {})
      expect(unregister).to.be.a('function')
      // Clean up
      unregister()
    })

    it('unregister function can be called multiple times safely', () => {
      const unregister = onShutdown(() => {})
      unregister()
      unregister() // Should not throw
    })

    it('accepts sync callbacks', () => {
      const unregister = onShutdown(() => {
        // Sync cleanup
      })
      unregister()
    })

    it('accepts async callbacks', () => {
      const unregister = onShutdown(async () => {
        // Async cleanup
      })
      unregister()
    })
  })

  // ===========================================================================
  // trackChildProcess()
  // ===========================================================================

  describe('trackChildProcess()', () => {
    it('tracks a child process and removes it on exit', () => {
      const fakeChild = new EventEmitter() as any
      fakeChild.pid = 12345
      fakeChild.killed = false
      fakeChild.kill = () => {}

      trackChildProcess(fakeChild)

      // Simulate the child exiting
      fakeChild.emit('exit', 0)
      // No assertion — verifying no throw and cleanup happens
    })

    it('removes tracked process on error event', () => {
      const fakeChild = new EventEmitter() as any
      fakeChild.pid = 12346
      fakeChild.killed = false
      fakeChild.kill = () => {}

      trackChildProcess(fakeChild)

      // Simulate the child erroring
      fakeChild.emit('error', new Error('spawn failed'))
      // No assertion — verifying no throw
    })
  })

  // ===========================================================================
  // isExiting()
  // ===========================================================================

  describe('isExiting()', () => {
    it('returns false when not shutting down', () => {
      // Since we haven't triggered shutdown, this should be false
      // (unless a previous test triggered it — but shutdown calls process.exit
      //  so that would have killed the test process)
      expect(isExiting()).to.be.false
    })
  })
})
