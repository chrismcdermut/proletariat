/**
 * Global setup for integration tests
 * Runs once before all tests
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export default async function globalSetup() {
  console.log('\n🔧 Setting up integration test environment...\n');

  // Build the project if not already built
  const distPath = path.join(process.cwd(), 'dist');
  if (!fs.existsSync(distPath)) {
    console.log('📦 Building project...');
    try {
      execSync('npm run build', { stdio: 'inherit' });
      console.log('✅ Build complete\n');
    } catch (error) {
      console.error('❌ Build failed. Please run "npm run build" manually.\n');
      process.exit(1);
    }
  } else {
    console.log('✅ Using existing build\n');
  }

  // Create temp directory for all tests if it doesn't exist
  const tempRoot = path.join(process.cwd(), '.test-tmp');
  if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
  }

  // Store paths in environment for tests to use
  process.env.TEST_TEMP_ROOT = tempRoot;
  process.env.PRLT_CLI_PATH = path.join(distPath, 'bin', 'prlt.js');

  console.log('📍 Test temp directory:', tempRoot);
  console.log('📍 CLI path:', process.env.PRLT_CLI_PATH);
  console.log('\n✨ Integration test environment ready!\n');
}