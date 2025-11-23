/**
 * Global teardown for integration tests
 * Runs once after all tests
 */

import * as fs from 'fs';
import * as path from 'path';

export default async function globalTeardown() {
  console.log('\n🧹 Cleaning up integration test environment...\n');

  // Clean up temp directory if it exists
  const tempRoot = process.env.TEST_TEMP_ROOT || path.join(process.cwd(), '.test-tmp');
  
  if (fs.existsSync(tempRoot)) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      console.log('✅ Cleaned up temp directory:', tempRoot);
    } catch (error) {
      console.warn('⚠️ Could not clean up temp directory:', error);
    }
  }

  console.log('\n✨ Integration test cleanup complete!\n');
}