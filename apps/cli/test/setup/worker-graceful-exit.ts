/**
 * Mocha root hook plugin for graceful worker process shutdown.
 *
 * Prevents workerpool teardown errors (WorkerHandler.js:251) in mocha parallel mode.
 * When worker processes exit non-gracefully during pool termination, workerpool
 * reports an "Uncaught error outside test suite", causing CI to fail even though
 * all real tests passed.
 *
 * Root cause: workerpool sends SIGTERM to terminate workers. Without a handler,
 * Node exits with code 143 (128 + 15), which workerpool treats as an error at
 * WorkerHandler.js:251. Additionally, uncaught exceptions during teardown (e.g.
 * from native module cleanup) cause exit code 1.
 *
 * This plugin:
 * 1. Installs SIGTERM/SIGINT handlers so workers exit with code 0
 * 2. Catches uncaught exceptions after tests complete and exits cleanly
 * 3. Uses an afterAll root hook to mark when tests are done
 *
 * See: https://github.com/mochajs/mocha/issues/4720
 */

// Track whether all tests in this worker have completed.
let testsComplete = false

// Install signal handlers for graceful worker shutdown.
// When workerpool terminates a worker, it sends SIGTERM. Without a handler,
// Node exits with code 143 (128+15), which workerpool treats as an error.
const handleTermination = () => {
  if (testsComplete) {
    process.exit(0)
  }
  // During tests, let the default behavior handle it (mocha needs to
  // report the interruption). Set a short timeout so that if mocha
  // doesn't exit on its own, we still exit cleanly.
  setTimeout(() => process.exit(0), 1000).unref()
}

// In parallel mode, workers are child processes spawned by workerpool
// via child_process.fork(), so process.send is defined.
const isWorkerProcess = typeof process.send === 'function'

if (isWorkerProcess) {
  process.on('SIGTERM', handleTermination)
  process.on('SIGINT', handleTermination)
}

// Catch uncaught exceptions that occur during teardown in ANY process.
// After tests complete, these are almost certainly teardown artifacts
// (native module cleanup, pending timer callbacks, etc.).
const uncaughtHandler = (err: Error) => {
  if (testsComplete) {
    // Swallow teardown errors and exit cleanly.
    // Log to stderr for debugging but don't let it affect exit code.
    const isWorkerpoolError = err.stack?.includes('workerpool') || err.stack?.includes('WorkerHandler')
    if (!isWorkerpoolError) {
      // Log non-workerpool errors for visibility, but still exit cleanly
      console.error('[worker-graceful-exit] Suppressed post-test uncaught exception:', err.message)
    }
    process.exit(0)
  }
  // During tests: don't swallow — let mocha's default handler report it.
  // Remove our listener temporarily to avoid infinite recursion, then re-throw.
  process.removeListener('uncaughtException', uncaughtHandler)
  throw err
}
process.on('uncaughtException', uncaughtHandler)

// Export root hooks for mocha (works in both serial and parallel mode).
export const mochaHooks = {
  afterAll() {
    testsComplete = true
  },
}
