#!/usr/bin/env node

import {execute} from '@oclif/core'

/**
 * Check if an error is related to native module loading issues.
 * Native modules like better-sqlite3 compile platform-specific binaries
 * that can become invalid when Node.js version or CPU architecture changes.
 */
function isNativeModuleError(error) {
  if (!error) return false;

  const errorMessage = error.message || '';
  const errorCode = error.code || '';

  // Common native module error patterns
  const nativeModulePatterns = [
    /dlopen.*\.node/i,                    // macOS/Linux dynamic library load failure
    /not a mach-o file/i,                 // macOS architecture mismatch
    /wrong ELF class/i,                   // Linux architecture mismatch
    /cannot open shared object/i,         // Linux missing library
    /is not a valid Win32 application/i,  // Windows architecture mismatch
    /The specified module could not be found/i, // Windows missing library
    /was compiled against a different Node\.js version/i, // Node.js ABI mismatch
    /NODE_MODULE_VERSION/i,               // Node.js ABI version mismatch
    /Module did not self-register/i,      // Native module registration failure
    /better.sqlite3/i,                    // Specific to our main native dependency
  ];

  return nativeModulePatterns.some(pattern =>
    pattern.test(errorMessage) || pattern.test(errorCode)
  );
}

/**
 * Display a user-friendly error message for native module issues.
 */
function displayNativeModuleError(error) {
  console.error('\n╭───────────────────────────────────────────────────────────────────╮');
  console.error('│  Native Module Error                                              │');
  console.error('╰───────────────────────────────────────────────────────────────────╯\n');

  console.error('The CLI encountered a native module compatibility issue.');
  console.error('This usually happens when:\n');
  console.error('  • Node.js was upgraded to a different version');
  console.error('  • Running on a different CPU architecture (e.g., x86 vs ARM)');
  console.error('  • node_modules were copied from another machine or Docker\n');

  console.error('To fix this, run one of the following commands:\n');
  console.error('  1. Rebuild just better-sqlite3:');
  console.error('     pnpm rebuild better-sqlite3\n');
  console.error('  2. Or do a clean install:');
  console.error('     rm -rf node_modules && pnpm install\n');

  console.error('Current Node.js version:', process.version);
  console.error('Expected Node.js version: 20.x (see .nvmrc)\n');

  // Show the original error for debugging
  if (process.env.DEBUG || process.env.VERBOSE) {
    console.error('Original error:', error.message);
    console.error('Stack trace:', error.stack);
  } else {
    console.error('Run with DEBUG=1 for more details.\n');
  }
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
    // Check for native module errors and provide helpful guidance
    if (isNativeModuleError(error)) {
      displayNativeModuleError(error);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  }
}
