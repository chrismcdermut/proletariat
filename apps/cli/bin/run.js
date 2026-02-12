#!/usr/bin/env node

import {execute} from '@oclif/core'

// Support -v as shorthand for --version (only when it's the sole argument,
// to avoid conflicts with command-specific -v flags like repo create --visibility)
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '-v') {
  process.argv[2] = '--version'
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n'); // Add newline for clean exit
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

try {
  await execute({dir: import.meta.url});
} catch (error) {
  // Handle any unhandled errors
  if (error.code !== 'EEXIT') {
    console.error(error);
    process.exit(1);
  }
}
