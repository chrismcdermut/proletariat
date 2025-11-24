#!/usr/bin/env node

import {execute} from '@oclif/core'

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
