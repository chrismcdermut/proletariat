#!/usr/bin/env node

import {execute} from '@oclif/core'

// Support -v as shorthand for --version (only when it's the sole argument,
// to avoid conflicts with command-specific -v flags like repo create --visibility)
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '-v') {
  process.argv[2] = '--version'
}

// Install centralized signal handlers for graceful Ctrl+C shutdown.
// This replaces the old per-handler approach and ensures:
// - Cleanup callbacks run in order
// - Tracked child processes are killed
// - Exit code 130 (standard Unix SIGINT convention)
// - No stack traces from ERR_USE_AFTER_CLOSE
import {installSignalHandlers, isExiting} from '../dist/lib/signal-handler.js'
installSignalHandlers()

try {
  await execute({dir: import.meta.url});
} catch (error) {
  if (error.code === 'EEXIT') {
    // Normal oclif exit - ignore
  } else if (isExiting()) {
    // SIGINT triggered during command execution - exit silently with 130
    process.exit(130);
  } else if (
    error.code === 'ERR_USE_AFTER_CLOSE' ||
    (error.message && error.message.includes('ERR_USE_AFTER_CLOSE')) ||
    (error.message && error.message.includes('readline was closed'))
  ) {
    // Readline/inquirer closed by SIGINT - exit silently
    process.exit(130);
  } else {
    console.error(error);
    process.exit(1);
  }
}
