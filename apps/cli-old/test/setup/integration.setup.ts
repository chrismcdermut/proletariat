/**
 * Setup file for integration tests
 * Runs before each test file
 */

import * as fs from 'fs';
import * as path from 'path';

// Ensure dist directory exists (tests run against compiled code)
const distPath = path.join(process.cwd(), 'dist');
if (!fs.existsSync(distPath)) {
  console.warn('Warning: dist directory not found. Run "npm run build" before running integration tests.');
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PRLT_TEST_MODE = 'true';

// Suppress console output during tests (optional)
if (process.env.QUIET_TESTS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Keep error for debugging
  };
}

// Add custom matchers if needed
expect.extend({
  toBeValidPath(received: string) {
    const pass = typeof received === 'string' && received.length > 0;
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid path`
        : `expected ${received} to be a valid path`,
    };
  },
});