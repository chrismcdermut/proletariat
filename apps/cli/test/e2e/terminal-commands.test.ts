import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execInProcess, filterOutput } from './test-helpers.js';

/**
 * End-to-end tests for Terminal Commands
 * Tests: prlt terminal title
 */
describe('Terminal Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-e2e-'));
    process.chdir(testDir);

    // Create minimal proletariat directory structure
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt terminal title', () => {
    it('should set terminal title with argument', async () => {
      const output = await execInProcess('terminal title "Test Title"');

      expect(filterOutput(output)).to.contain('Terminal title set to');
      expect(filterOutput(output)).to.contain('Test Title');
    });

    it('should reset terminal title with --reset flag', async () => {
      const output = await execInProcess('terminal title --reset');

      expect(filterOutput(output)).to.contain('Terminal title reset to default');
    });

    it('should accept title with spaces', async () => {
      const output = await execInProcess('terminal title "My Custom Terminal Title"');

      expect(filterOutput(output)).to.contain('My Custom Terminal Title');
    });

    it('should accept title with ticket ID format', async () => {
      const output = await execInProcess('terminal title "TKT-123 Implementation"');

      expect(filterOutput(output)).to.contain('TKT-123 Implementation');
    });

    it('should show help with --help flag', async () => {
      const output = await execInProcess('terminal title --help');

      expect(filterOutput(output)).to.contain('Set the terminal tab/window title');
      expect(filterOutput(output)).to.contain('--reset');
    });
  });
});
